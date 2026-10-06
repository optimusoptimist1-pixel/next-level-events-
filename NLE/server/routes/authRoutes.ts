import express, { Request, Response } from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";

import sendEmail from "../utils/sendEmail.js";
import { login } from "../controllers/authController.js";
import authMiddleware from "../middleware/authMiddleware.js";
import { signAuthToken } from "../utils/auth.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { verifyFirebaseIdToken } from "../utils/firebaseAdmin.js";
import { UserRepository, WishlistRepository, DbUser } from "../src/db/repositories.js";
import { supabase } from "../src/db/supabase.js";
import { syncUserToSupabaseAuth } from "../src/db/supabaseAuth.js";

const router = express.Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: "Too many attempts. Please wait a few minutes and try again.",
});

const profileFieldMap: Record<string, keyof DbUser> = {
  firstName: "first_name",
  lastName: "last_name",
  phone: "phone",
  gender: "gender",
  dateOfBirth: "date_of_birth",
  address: "address",
  city: "city",
  state: "state",
  country: "country",
  pincode: "pincode",
  photoURL: "photo_url",
};

function publicUser(user: DbUser, wishlist: string[] = []) {
  const email = typeof user.email === "string" ? user.email.trim() : "";
  const firstName = typeof user.first_name === "string" ? user.first_name.trim() : "";
  const lastName = typeof user.last_name === "string" ? user.last_name.trim() : "";
  const photoURL = typeof user.photo_url === "string" ? user.photo_url.trim() : "";

  const role =
    typeof user.role === "string" && user.role === "admin"
      ? "admin"
      : typeof user.role === "string" && user.role === "staff"
        ? "staff"
        : "user";

  return {
    id: user.id,
    _id: user.id,
    email,
    role,
    permissions: role === "staff" && Array.isArray(user.permissions) ? user.permissions.map(String) : undefined,
    wishlist,
    name: [firstName, lastName].filter(Boolean).join(" ") || email,
    avatar: photoURL,
    photoURL,
    firstName,
    lastName,
    phone: typeof user.phone === "string" ? user.phone.trim() : "",
    gender: typeof user.gender === "string" ? user.gender.trim() : "",
    dateOfBirth: typeof user.date_of_birth === "string" ? user.date_of_birth.trim() : "",
    address: typeof user.address === "string" ? user.address.trim() : "",
    city: typeof user.city === "string" ? user.city.trim() : "",
    state: typeof user.state === "string" ? user.state.trim() : "",
    country: typeof user.country === "string" ? user.country.trim() : "",
    pincode: typeof user.pincode === "string" ? user.pincode.trim() : "",
  };
}

router.post("/login", authLimiter, login);

router.get("/profile", authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = (req as Request & { user?: { id?: string } }).user?.id;
    if (!userId) return res.status(401).json({ msg: "Unauthorized" });

    const user = await UserRepository.findById(userId);
    if (!user) return res.status(404).json({ msg: "User not found" });

    const wishlist = await WishlistRepository.getByUserId(userId);
    return res.json({ user: publicUser(user, wishlist) });
  } catch {
    return res.status(500).json({ msg: "Failed to load profile" });
  }
});

router.get("/me", authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = (req as Request & { user?: { id?: string } }).user?.id;
    if (!userId) return res.status(401).json({ msg: "Unauthorized" });

    const user = await UserRepository.findById(userId);
    if (!user) return res.status(404).json({ msg: "User not found" });

    const wishlist = await WishlistRepository.getByUserId(userId);
    return res.json({ user: publicUser(user, wishlist) });
  } catch {
    return res.status(500).json({ msg: "Failed to load current user" });
  }
});

router.put("/profile", authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = (req as Request & { user?: { id?: string } }).user?.id;
    if (!userId) return res.status(401).json({ msg: "Unauthorized" });

    const updates: Partial<DbUser> = {};
    for (const [clientKey, dbKey] of Object.entries(profileFieldMap)) {
      if (clientKey in req.body && typeof req.body[clientKey] === "string") {
        (updates as any)[dbKey] = req.body[clientKey].trim();
      }
    }

    const user = await UserRepository.update(userId, updates);
    if (!user) return res.status(404).json({ msg: "User not found" });

    const wishlist = await WishlistRepository.getByUserId(userId);
    return res.json({ user: publicUser(user, wishlist) });
  } catch {
    return res.status(500).json({ msg: "Failed to save profile" });
  }
});

router.post("/register", authLimiter, async (req: Request, res: Response) => {
  try {
    const { email, password, role: requestedRole, adminSecret } = req.body;
    if (!email || !password) {
      return res.status(400).json({ msg: "Email and password are required." });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const existing = await UserRepository.findByEmail(normalizedEmail);
    if (existing) {
      return res.status(400).json({ msg: "User already exists" });
    }

    let role: "user" | "admin" | "staff" = "user";
    if (requestedRole === "admin") {
      const adminSecretEnv = process.env.ADMIN_SECRET;
      if (!adminSecretEnv || adminSecretEnv.length < 8) {
        return res.status(403).json({ msg: "Admin registration is disabled on this server." });
      }
      if (adminSecret !== adminSecretEnv) {
        return res.status(403).json({ msg: "Invalid Admin Security Passcode. Access denied." });
      }
      role = "admin";
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const firstName = req.body.firstName || normalizedEmail.split("@")[0];
    const lastName = req.body.lastName || "";
    const phone = req.body.phone ? String(req.body.phone).trim() : null;

    // Auto-register in Supabase Auth with email_confirm: true (no email verification required)
    const authResult = await syncUserToSupabaseAuth({
      email: normalizedEmail,
      password: String(password),
      role,
      firstName,
      lastName,
      phone,
      confirmEmail: true,
    });

    await UserRepository.create({
      ...(authResult.authId ? { id: authResult.authId } : {}),
      email: normalizedEmail,
      password_hash: hashedPassword,
      first_name: firstName,
      last_name: lastName,
      phone,
      role,
    });

    res.json({ msg: role === "admin" ? "Admin registered successfully" : "User registered successfully", role });

    sendEmail(
      normalizedEmail,
      "Welcome to TheDecorParty",
      `
<h2>🎉 Welcome to TheDecorParty</h2>
<p>Your account has been created successfully.</p>
<p><strong>Email:</strong> ${normalizedEmail}</p>
<ul>
  <li>Birthday Decorations</li>
  <li>Anniversary Setups</li>
  <li>Candle Light Dinners</li>
  <li>Proposal Events</li>
</ul>
<p>We are excited to help you celebrate your special moments.</p>
<p>Regards,<br>TheDecorParty Team</p>
`
    ).catch((err: Error) => console.log("Email failed:", err.message));
  } catch (err) {
    console.error("[auth] register error", err);
    res.status(500).json({ msg: "Server error" });
  }
});

// Exchanges a Firebase Auth ID token (Google popup, or email/password sign
// in/up) for our own app session -- the only two auth methods the client
// offers. verifyFirebaseIdToken() rejects anything else.
router.post("/google", authLimiter, async (req: Request, res: Response) => {
  try {
    const { token: firebaseIdToken } = req.body || {};
    if (!firebaseIdToken || typeof firebaseIdToken !== "string") {
      return res.status(400).json({ msg: "Missing sign-in token." });
    }

    let identity;
    try {
      identity = await verifyFirebaseIdToken(firebaseIdToken);
    } catch (err: any) {
      return res.status(err?.statusCode || 401).json({ msg: err?.message || "Invalid sign-in token." });
    }

    const { uid, email, emailVerified, signInProvider, firstName, lastName, photoURL } = identity;
    const normalizedEmail = email.trim().toLowerCase();

    // Firebase does not verify an address at email/password signup, so anyone
    // can create a "password" account for someone else's email. Never let such
    // a token take over an existing account unless it's provably the same
    // Firebase account (stored uid) or the address is verified. Google tokens
    // always carry a verified address.
    if (signInProvider === "google.com" && !emailVerified) {
      return res.status(401).json({ msg: "Your Google account's email address is not verified." });
    }

    let user = await UserRepository.findByEmail(normalizedEmail);

    if (user) {
      const sameFirebaseAccount = !!user.google_id && user.google_id === uid;
      if (!sameFirebaseAccount && !emailVerified) {
        const privileged = user.role === "admin" || user.role === "staff";
        const boundToSomeoneElse = !!user.google_id;
        if (privileged || boundToSomeoneElse) {
          return res.status(403).json({
            msg: "This email is already registered. Please sign in with Google, or verify your email address first.",
          });
        }
      }
      // First sign-in via Firebase for an existing, unbound customer: bind it
      // so only this Firebase account can claim this user from now on.
      if (!user.google_id) {
        user = (await UserRepository.update(user.id, { google_id: uid })) || user;
      }
    }

    if (!user) {
      user = await UserRepository.create({
        first_name: firstName || normalizedEmail.split("@")[0],
        last_name: lastName || "",
        email: normalizedEmail,
        google_id: uid,
        photo_url: photoURL || "",
        role: "user",
      });

      sendEmail(
        normalizedEmail,
        "Welcome to TheDecorParty",
        `
<h2>🎉 Welcome to TheDecorParty, ${firstName}!</h2>
<p>Your account has been created successfully.</p>
<p><strong>Email:</strong> ${normalizedEmail}</p>
<p>Regards,<br>TheDecorParty Team</p>
`
      ).catch((err: Error) => console.log("Email failed:", err.message));
    }

    const role: "admin" | "staff" | "user" =
      user.role === "admin" ? "admin" : user.role === "staff" ? "staff" : "user";

    const token = signAuthToken({ id: user.id, role });
    const wishlist = await WishlistRepository.getByUserId(user.id);

    return res.json({
      token,
      user: publicUser(user, wishlist),
    });
  } catch (err) {
    console.error("[auth] google error", err);
    return res.status(500).json({ msg: "Server error" });
  }
});

router.post("/supabase-oauth", authLimiter, async (req: Request, res: Response) => {
  try {
    const { access_token } = req.body || {};
    if (!access_token || typeof access_token !== "string") {
      return res.status(400).json({ msg: "Missing Supabase access token." });
    }

    const { data: userData, error: userError } = await supabase.auth.getUser(access_token);
    if (userError || !userData?.user) {
      return res.status(401).json({ msg: userError?.message || "Invalid or expired Supabase session." });
    }

    const sbUser = userData.user;
    const email = sbUser.email?.trim().toLowerCase();
    if (!email) {
      return res.status(400).json({ msg: "Supabase account has no associated email address." });
    }

    let user = await UserRepository.findByEmail(email);

    if (!user) {
      const meta = sbUser.user_metadata || {};
      const firstName = meta.first_name || meta.full_name?.split(" ")[0] || email.split("@")[0];
      const lastName = meta.last_name || meta.full_name?.split(" ").slice(1).join(" ") || "";
      const photoURL = meta.avatar_url || meta.picture || "";

      user = await UserRepository.create({
        first_name: firstName,
        last_name: lastName,
        email,
        photo_url: photoURL,
        role: "user",
      });
    }

    if (user.role !== "admin" && user.role !== "staff") {
      return res.status(403).json({
        msg: `Access denied. The account (${email}) does not have admin console permissions.`,
      });
    }

    const role: "admin" | "staff" = user.role === "admin" ? "admin" : "staff";
    const token = signAuthToken({ id: user.id, role });
    const wishlist = await WishlistRepository.getByUserId(user.id);

    return res.json({
      token,
      user: publicUser(user, wishlist),
    });
  } catch (err: any) {
    console.error("[auth] supabase-oauth error:", err);
    return res.status(500).json({ msg: "Server error during Supabase OAuth exchange" });
  }
});


router.post("/phone", authLimiter, (_req: Request, res: Response) => {
  return res.status(410).json({
    success: false,
    message: "This endpoint is disabled. Use /api/auth/otp/request and /api/auth/otp/verify.",
  });
});

router.post("/forgot-password", authLimiter, async (req: Request, res: Response) => {
  try {
    const { email } = req.body || {};
    if (!email) {
      return res.json({ msg: "If an account exists, a password reset link has been sent to the email address" });
    }

    const user = await UserRepository.findByEmail(email);

    if (user) {
      const token = crypto.randomBytes(32).toString("hex");
      const hashed = crypto.createHash("sha256").update(token).digest("hex");
      const expires = new Date(Date.now() + 15 * 60 * 1000).toISOString();

      await UserRepository.update(user.id, {
        reset_password_token: hashed,
        reset_password_expires: expires,
      });

      const frontendBase = process.env.FRONTEND_URL || "http://localhost:5173";
      const resetUrl = `${frontendBase.replace(/\/$/, "")}/reset-password/${token}`;

      const html = `
<p>You requested a password reset for your account at TheDecorParty.</p>
<p>Click the link below to reset your password. This link expires in 15 minutes.</p>
<p><a href="${resetUrl}">${resetUrl}</a></p>
<p>If you didn't request this, you can safely ignore this email.</p>
`;

      const destinationEmail = user.email || "";
      sendEmail(destinationEmail, "Reset your TheDecorParty password", html).catch((err: Error) =>
        console.error("Email failed:", err && err.message)
      );
    }

    return res.json({ msg: "If an account exists, a password reset link has been sent to the email address" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ msg: "Server error" });
  }
});

router.post("/reset-password/:token", authLimiter, async (req: Request, res: Response) => {
  try {
    const token = String(req.params.token || "");
    const { password } = req.body || {};
    if (!token || !password) return res.status(400).json({ msg: "Invalid request" });

    const hashed = crypto.createHash("sha256").update(token).digest("hex");
    const user = await UserRepository.findByResetToken(hashed);

    if (!user) {
      return res.status(400).json({ msg: "Invalid or expired token" });
    }

    if (typeof password !== "string" || password.length < 6) {
      return res.status(400).json({ msg: "Password must be at least 6 characters" });
    }

    const newHashed = await bcrypt.hash(password, 10);
    await UserRepository.update(user.id, {
      password_hash: newHashed,
      reset_password_token: null,
      reset_password_expires: null,
    });

    return res.json({ msg: "Password reset successful" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ msg: "Server error" });
  }
});

export default router;
