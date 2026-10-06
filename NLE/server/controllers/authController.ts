import bcrypt from "bcryptjs";
import { Request, Response } from "express";
import { UserRepository, WishlistRepository } from "../src/db/repositories.js";
import { signAuthToken } from "../utils/auth.js";

export const login = async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ msg: "Email and password are required" });
    }

    const user = await UserRepository.findByEmail(email);

    if (!user) {
      return res.status(400).json({ msg: "User not found" });
    }

    if (!user.password_hash) {
      return res.status(400).json({ msg: "Invalid password" });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);

    if (!isMatch) {
      return res.status(400).json({ msg: "Invalid password" });
    }

    const role: "admin" | "staff" | "user" =
      user.role === "admin"
        ? "admin"
        : user.role === "staff"
          ? "staff"
          : "user";

    const permissions: string[] = Array.isArray(user.permissions) ? user.permissions.map(String) : [];
    const token = signAuthToken(
      { id: user.id, role, ...(role === "staff" ? { permissions } : {}) },
      "1d"
    );

    const wishlist = await WishlistRepository.getByUserId(user.id);

    return res.json({
      token,
      user: {
        id: user.id,
        _id: user.id,
        wishlist,
        name: [user.first_name, user.last_name].filter(Boolean).join(" ") || user.email,
        firstName: user.first_name || email.split("@")[0],
        lastName: user.last_name || "",
        email: user.email,
        role,
        permissions: role === "staff" ? permissions : undefined,
        phone: user.phone || "",
        gender: user.gender || "",
        dateOfBirth: user.date_of_birth || "",
        address: user.address || "",
        city: user.city || "",
        state: user.state || "",
        country: user.country || "",
        pincode: user.pincode || "",
        photoURL: user.photo_url || "",
        avatar: user.photo_url || "",
      },
    });
  } catch (err) {
    console.error("[auth] login error", err);
    return res.status(500).json({ msg: "Server error" });
  }
};

export default { login };
