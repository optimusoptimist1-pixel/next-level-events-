import { useState, useEffect } from "react";
import type { AdminProduct, AdminCategory, AdminAddon } from "../../types";
import { Modal } from "./Modal";
import { ConfirmModal } from "./ConfirmModal";
import { toast } from "react-toastify";
import { Pencil, Eye, EyeOff, Trash2, Upload, Link as LinkIcon, X, Star, Lightbulb, Copy } from "lucide-react";
import { cn } from "../../lib/utils";
import { getApiUrl, authFetch, parseJsonSafe } from '../../lib/api';
import { supabase } from '../../lib/supabase';
import { UPLOAD_URL } from '../../lib/uploads';
import { compressImage } from '../../lib/imageCompress';
import { resolveImageUrl, handleImageError } from '../../lib/imageUrl';
import { BADGE_COLORS, getAdminBadgeColorClass } from '../../lib/badges';
import { trackAdminAction } from '../../lib/analytics';
import { broadcastCrmUpdate } from '../../lib/syncChannel';

const getProductsApi = () => getApiUrl('/api/products');
const getCategoriesApi = () => getApiUrl('/api/categories');
const API = { toString: getProductsApi, valueOf: getProductsApi, [Symbol.toPrimitive]: getProductsApi } as unknown as string;
const CAT_API = { toString: getCategoriesApi, valueOf: getCategoriesApi, [Symbol.toPrimitive]: getCategoriesApi } as unknown as string;

const labelClass = "text-xs font-extrabold uppercase text-[#381932] dark:text-[#381932]";
const inputClass = "mt-1 w-full rounded-xl border border-[#381932] dark:border-[#381932] bg-[#FFF3E6] dark:bg-[#381932] px-3.5 py-2.5 text-xs font-semibold text-[#381932] dark:text-[#FFF3E6] outline-none";
const dropzoneClass = "rounded-2xl border-2 border-dashed border-[#381932] dark:border-[#381932] p-6 text-center bg-[#FFF3E6]/50 dark:bg-[#381932]/40";
const footerClass = "flex items-center justify-end gap-3 border-t border-[#381932] dark:border-[#381932] pt-4";
const ghostBtnClass = "rounded-xl border border-[#381932] dark:border-[#381932] px-4 py-2.5 text-xs font-bold text-[#381932] dark:text-[#381932] cursor-pointer";
const primaryBtnClass = "rounded-xl bg-[#381932] text-[#FFF3E6] px-4 py-2.5 text-xs font-bold shadow-md shadow-[#381932]/20 disabled:opacity-60 cursor-pointer";
const tabClass = (active: boolean) =>
  `rounded-xl px-3 py-1.5 text-xs font-bold transition-all cursor-pointer ${active ? "bg-[#381932] text-[#FFF3E6]" : "bg-[#FFF3E6] dark:bg-[#381932] text-[#381932] dark:text-[#381932]"}`;
const imageModeTabs = (mode: "url" | "upload", setMode: (m: "url" | "upload") => void) => (
  <div className="flex gap-2 border-b border-[#381932] dark:border-[#381932] pb-2">
    <button type="button" className={tabClass(mode === "upload")} onClick={() => setMode("upload")}>
      <Upload size={13} className="mr-1 inline" /> Upload File
    </button>
    <button type="button" className={tabClass(mode === "url")} onClick={() => setMode("url")}>
      <LinkIcon size={13} className="mr-1 inline" /> Image URL
    </button>
  </div>
);

export const ProductsView = () => {
  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [categories, setCategories] = useState<AdminCategory[]>([]);
  const [availableAddons, setAvailableAddons] = useState<AdminAddon[]>([]);
  const [selectedAddonIds, setSelectedAddonIds] = useState<string[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<AdminProduct | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; name: string } | null>(null);
  const [imageMode, setImageMode] = useState<"url" | "upload">("upload");
  const [uploading, setUploading] = useState(false);
  const [moreImagesMode, setMoreImagesMode] = useState<"url" | "upload">("upload");
  const [moreUploading, setMoreUploading] = useState(false);

  const [form, setForm] = useState({
    name: "",
    categoryId: "",
    categoryName: "",
    subcategory: "",
    price: 0,
    originalPrice: 0,
    description: "",
    inclusions: [] as string[],
    addOns: [] as { name: string; price: number }[],
    image: "",
    moreImages: [] as string[],
    badge: "",
    badgeColor: "purple" as string,
    active: true,
    featured: false,
  });

  const copyToClipboard = async (value: string) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      toast.success('Copied link');
    } catch {
      toast.error('Failed to copy link');
    }
  };

  const [newInclusion, setNewInclusion] = useState("");
  const [showAddCategoryModal, setShowAddCategoryModal] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");

  const fetchProducts = async () => {
    try {
      const res = await authFetch(getProductsApi());
      const parsed = await parseJsonSafe<AdminProduct[]>(res);
      if (parsed.ok && Array.isArray(parsed.data)) {
        setProducts(parsed.data);
        return;
      }
    } catch {
      // Continue to Supabase direct fallback
    }

    try {
      const { data, error } = await supabase.from('products').select('*').order('created_at', { ascending: false });
      if (!error && Array.isArray(data)) {
        const mapped: AdminProduct[] = data.map((p: any) => ({
          _id: p.id || p._id,
          name: p.name,
          categoryId: p.category_id || p.categoryId,
          categoryName: p.category_name || p.categoryName || '',
          subcategory: p.subcategory || '',
          price: Number(p.price || 0),
          originalPrice: Number(p.original_price || p.originalPrice || 0),
          description: p.description || '',
          inclusions: Array.isArray(p.inclusions) ? p.inclusions : [],
          addOns: Array.isArray(p.add_ons) ? p.add_ons : (p.addOns || []),
          image: p.image || '',
          moreImages: Array.isArray(p.more_images) ? p.more_images : (p.moreImages || []),
          badge: p.badge || '',
          badgeColor: p.badge_color || p.badgeColor || 'purple',
          active: p.active ?? true,
          featured: p.featured ?? false,
          rating: Number(p.rating || 5),
          reviewCount: Number(p.review_count || p.reviewCount || 0),
          createdAt: p.created_at || new Date().toISOString(),
          updatedAt: p.updated_at || new Date().toISOString(),
        }));
        setProducts(mapped);
        return;
      }
    } catch {
      toast.error("Failed to load products");
    }
  };

  const fetchCategories = async () => {
    try {
      const res = await authFetch(getCategoriesApi());
      const parsed = await parseJsonSafe<AdminCategory[]>(res);
      if (parsed.ok && Array.isArray(parsed.data)) {
        setCategories(parsed.data);
        return;
      }
    } catch {
      // Continue to Supabase direct fallback
    }

    try {
      const { data, error } = await supabase.from('categories').select('*').order('order_index', { ascending: true });
      if (!error && Array.isArray(data)) {
        const mapped: AdminCategory[] = data.map((c: any) => ({
          _id: c.id || c._id,
          name: c.name,
          icon: c.icon || '',
          image: c.image || '',
          slug: c.slug || '',
          active: c.active ?? true,
          subcategories: Array.isArray(c.subcategories) ? c.subcategories : [],
        }));
        setCategories(mapped);
        return;
      }
    } catch {
      toast.error("Failed to load categories");
    }
  };

  const fetchAddons = async () => {
    try {
      const res = await authFetch(getApiUrl('/api/addons/active'));
      const parsed = await parseJsonSafe<AdminAddon[]>(res);
      if (parsed.ok && Array.isArray(parsed.data)) {
        setAvailableAddons(parsed.data);
        return;
      }
    } catch {
      // Continue to Supabase direct fallback
    }

    try {
      const { data, error } = await supabase.from('addons').select('*').eq('active', true);
      if (!error && Array.isArray(data)) {
        setAvailableAddons(data.map((a: any) => ({
          _id: a.id || a._id,
          name: a.name,
          price: Number(a.price || 0),
          description: a.description || '',
          image: a.image || '',
          active: a.active ?? true,
          createdAt: a.created_at || new Date().toISOString(),
          updatedAt: a.updated_at || new Date().toISOString(),
        })));
      }
    } catch {
      toast.error("Failed to load add-ons");
    }
  };

  useEffect(() => {
    fetchProducts();
    fetchCategories();
    fetchAddons();
  }, []);

  const getSubcategories = (): string[] => {
    const cat = categories.find((c) => c._id === form.categoryId);
    if (!cat?.subcategories) return [];

    return cat.subcategories.map((sub) =>
      typeof sub === "string" ? sub : sub.name
    );
  };

  const openAdd = () => {
    setEditing(null);
    setSelectedAddonIds([]);
    setForm({
      name: "",
      categoryId: "",
      categoryName: "",
      subcategory: "",
      price: 0,
      originalPrice: 0,
      description: "",
      inclusions: [],
      addOns: [],
      image: "",
      moreImages: [],
      badge: "",
      badgeColor: "purple",
      active: true,
      featured: false,
    });
    setImageMode("upload");
    setShowModal(true);
  };

  const openEdit = (p: AdminProduct) => {
    setEditing(p);
    const selectedIds = (Array.isArray(p.addons) ? p.addons : []).map((addon) => typeof addon === "string" ? addon : addon._id).filter(Boolean);
    setSelectedAddonIds(selectedIds);
    setForm({
      name: p.name,
      categoryId: p.categoryId,
      categoryName: p.categoryName,
      subcategory: p.subcategory,
      price: p.price,
      originalPrice: p.originalPrice || 0,
      description: p.description,
      inclusions: p.inclusions || [],
      addOns: p.addOns || [],
      image: p.image,
      moreImages: p.moreImages || [],
      badge: p.badge || "",
      badgeColor: p.badgeColor,
      active: p.active,
      featured: p.featured,
    });
    setImageMode("upload");
    setShowModal(true);
  };

  const uploadImageFile = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error("Please upload an image file");
      return;
    }

    setUploading(true);
    const compressed = await compressImage(file);
    if (compressed.size > 4 * 1024 * 1024) {
      toast.error("Image is still over 4MB after compression");
      setUploading(false);
      return;
    }
    const formData = new FormData();
    formData.append("file", compressed);
    formData.append("folder", "ems/products");

    try {
      const response = await authFetch(
        UPLOAD_URL,
        {
          method: "POST",
          body: formData,
        }
      );

      if (!response.ok) throw new Error("Upload failed");

      const data = await response.json();
      setForm((f) => ({ ...f, image: data.secure_url }));
      toast.success("Image uploaded successfully!");
    } catch (error) {
      toast.error("Failed to upload image. Please try again.");
      console.error("Upload error:", error);
    } finally {
      setUploading(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await uploadImageFile(file);
    e.target.value = "";
  };

  const handleImageDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    await uploadImageFile(file);
  };

  const uploadMoreImageFile = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error("Please upload an image file");
      return;
    }

    setMoreUploading(true);
    const compressed = await compressImage(file);
    if (compressed.size > 4 * 1024 * 1024) {
      toast.error("Image is still over 4MB after compression");
      setMoreUploading(false);
      return;
    }
    const formData = new FormData();
    formData.append("file", compressed);
    formData.append("folder", "ems/products");

    try {
      const response = await authFetch(
        UPLOAD_URL,
        {
          method: "POST",
          body: formData,
        }
      );

      if (!response.ok) throw new Error("Upload failed");

      const data = await response.json();
      setForm((f) => ({ ...f, moreImages: [...f.moreImages, data.secure_url] }));
      toast.success("Image added!");
    } catch (error) {
      toast.error("Failed to upload image. Please try again.");
      console.error("Upload error:", error);
    } finally {
      setMoreUploading(false);
    }
  };

  const handleMoreImagesUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await uploadMoreImageFile(file);
    e.target.value = "";
  };

  const handleMoreImagesDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    await uploadMoreImageFile(file);
  };

  const save = async () => {
    if (!form.name.trim()) {
      toast.error("Product name is required");
      return;
    }

    if (!form.categoryId) {
      toast.error("Please select a category");
      return;
    }

    if (!form.image.trim()) {
      toast.error("Product image is required");
      return;
    }

    if (form.price <= 0) {
      toast.error("Price must be greater than 0");
      return;
    }

    const selectedCat = categories.find((c) => c._id === form.categoryId);
    const selectedSnapshots = availableAddons
      .filter((addon) => selectedAddonIds.includes(addon._id))
      .map((addon) => ({ id: addon._id, name: addon.name, price: addon.price }));

    const existingInlineAddOns = Array.isArray(form.addOns) ? form.addOns : [];
    const mergedAddOns = [
      ...selectedSnapshots,
      ...existingInlineAddOns.filter((inline) =>
        !selectedSnapshots.some((addon) => addon.name.trim().toLowerCase() === inline.name.trim().toLowerCase())
      ),
    ];

    const payload = {
      ...form,
      categoryName: selectedCat?.name || "",
      addons: selectedAddonIds,
      addOns: mergedAddOns,
    };

    if (editing) {
      try {
        const res = await authFetch(`${API}/${editing._id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const updated = await res.json();
        setProducts((prev) => prev.map((p) => (p._id === updated._id ? updated : p)));
        trackAdminAction('update_product', 'product', updated._id);
        broadcastCrmUpdate('product', updated._id);
        toast.success("Product updated successfully!");
      } catch {
        toast.error("Failed to update product");
      }
    } else {
      const res = await authFetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const newProduct = await res.json();
      setProducts((prev) => [newProduct, ...prev]);
      trackAdminAction('create_product', 'product', newProduct._id);
      broadcastCrmUpdate('product', newProduct._id);
      toast.success("Product added successfully!");
    }

    setShowModal(false);
  };

  const del = async (id: string) => {
    await authFetch(`${API}/${id}`, { method: "DELETE" });
    setProducts((prev) => prev.filter((p) => p._id !== id));
    setDeleteConfirm(null);
    trackAdminAction('delete_product', 'product', id);
    broadcastCrmUpdate('product', id);
    toast.success("Product deleted!");
  };

  const toggle = async (id: string, active: boolean) => {
    await authFetch(`${API}/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active }),
    });
    setProducts((prev) => prev.map((p) => (p._id === id ? { ...p, active } : p)));
    broadcastCrmUpdate('product', id);
  };

  const addInclusion = () => {
    if (!newInclusion.trim()) return;
    setForm((f) => ({ ...f, inclusions: [...f.inclusions, newInclusion.trim()] }));
    setNewInclusion("");
  };

  const removeInclusion = (idx: number) => {
    setForm((f) => ({ ...f, inclusions: f.inclusions.filter((_, i) => i !== idx) }));
  };

  const removeMoreImage = (idx: number) => {
    setForm((f) => ({ ...f, moreImages: f.moreImages.filter((_, i) => i !== idx) }));
  };

  const addNewCategory = async () => {
    if (!newCategoryName.trim()) {
      toast.error("Category name is required");
      return;
    }

    try {
      const res = await authFetch(CAT_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newCategoryName.trim(),
          icon: "📦",
          image: "",
          slug: newCategoryName.toLowerCase().replace(/\s+/g, "-"),
          active: true,
        }),
      });

      if (!res.ok) {
        const error = await res.json();
        toast.error(error.message || "Failed to add category");
        return;
      }

      const newCategory = await res.json();
      setCategories((prev) => [...prev, newCategory]);
      setForm((f) => ({ ...f, categoryId: newCategory._id, subcategory: "" }));
      setNewCategoryName("");
      setShowAddCategoryModal(false);
      toast.success("Category added successfully!");
    } catch {
      toast.error("Failed to add category");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-2xl border border-[#381932] dark:border-[#381932] bg-[#FFF3E6] dark:bg-[#381932] p-5 shadow-xs">
        <div>
          <h2 className="text-xl font-black text-[#381932] dark:text-[#FFF3E6]">Event Decoration Packages</h2>
          <p className="text-xs font-semibold text-[#381932] dark:text-[#381932] mt-0.5">Manage decor packages, pricing, inclusions, and photo galleries.</p>
        </div>
        <button 
          type="button" 
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#381932] hover:opacity-90 text-[#FFF3E6] px-4 py-2.5 text-xs font-bold shadow-md shadow-[#381932]/20 active:scale-95 transition-all cursor-pointer" 
          onClick={openAdd}
        >
          + Add Product
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {products.map((prod) => (
          <div key={prod._id} className={cn('overflow-hidden rounded-2xl border border-[#381932] dark:border-[#381932] bg-[#FFF3E6] dark:bg-[#381932] shadow-xs flex flex-col justify-between transition-all', !prod.active && 'opacity-60')}>
            <div>
              <div className="relative aspect-video w-full bg-[#FFF3E6] dark:bg-[#381932] overflow-hidden">
                <img src={resolveImageUrl(prod.image)} alt={prod.name} className="h-full w-full object-cover" onError={handleImageError} />
                {prod.badge && (
                  <span className={cn('absolute left-2.5 top-2.5 rounded-full px-2.5 py-0.5 text-[10px] font-extrabold uppercase border', getAdminBadgeColorClass(prod.badgeColor))}>
                    {prod.badge}
                  </span>
                )}
                {prod.featured && (
                  <span className="absolute right-2.5 top-2.5 flex h-7 w-7 items-center justify-center rounded-full bg-[#FFF3E6]/90 dark:bg-[#381932]/90 text-[#381932] shadow-xs">
                    <Star size={14} fill="currentColor" />
                  </span>
                )}
              </div>
              <div className="p-4 space-y-1">
                <h3 className="truncate text-sm font-bold text-[#381932] dark:text-[#FFF3E6]">{prod.name}</h3>
                <p className="text-xs font-semibold text-[#381932] dark:text-[#381932] truncate">
                  {prod.categoryName} {prod.subcategory && `\u00b7 ${prod.subcategory}`}
                </p>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-sm font-black text-[#381932] dark:text-[#381932]">&#8377;{Number(prod.price || 0).toLocaleString('en-IN')}</span>
                  {(prod.originalPrice ?? 0) > 0 && (
                    <span className="text-xs text-[#381932] line-through">&#8377;{Number(prod.originalPrice || 0).toLocaleString('en-IN')}</span>
                  )}
                </div>
              </div>
            </div>

            <div className="p-4 pt-0 flex items-center gap-1.5">
              <button 
                type="button" 
                className="flex-1 inline-flex items-center justify-center gap-1 rounded-xl border border-[#381932] dark:border-[#381932] bg-[#FFF3E6] dark:bg-[#381932] px-3 py-2 text-xs font-bold text-[#381932] dark:text-[#381932] hover:bg-[#FFF3E6] dark:hover:bg-[#381932] transition-colors cursor-pointer" 
                onClick={() => openEdit(prod)}
              >
                <Pencil size={12} /> Edit
              </button>
              <button 
                type="button" 
                className="inline-flex items-center justify-center rounded-xl border border-[#381932] dark:border-[#381932] bg-[#FFF3E6] dark:bg-[#381932] p-2 text-xs font-bold text-[#381932] dark:text-[#381932] hover:bg-[#FFF3E6] cursor-pointer" 
                onClick={() => copyToClipboard(`/product/${prod._id}`)}
                title="Copy Product Link"
              >
                <Copy size={12} />
              </button>
              <button 
                type="button" 
                className="inline-flex items-center justify-center rounded-xl border border-[#381932] dark:border-[#381932] bg-[#FFF3E6] dark:bg-[#381932] p-2 text-xs font-bold text-[#381932] dark:text-[#381932] hover:bg-[#FFF3E6] cursor-pointer" 
                onClick={() => toggle(prod._id, !prod.active)}
              >
                {prod.active ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
              <button
                type="button"
                className="inline-flex items-center justify-center rounded-xl border border-[#381932] dark:border-[#381932]/50 bg-[#FFF3E6] dark:bg-[#381932]/40 p-2 text-xs font-bold text-[#381932] dark:text-[#381932] hover:bg-[#FFF3E6] cursor-pointer"
                onClick={() => setDeleteConfirm({ id: prod._id, name: prod.name })}
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>

      {showModal && (
        <Modal
          title={editing ? "Edit Product" : "Add Product"}
          onClose={() => setShowModal(false)}
          large
        >
          <div className="flex flex-col gap-4">
            <div>
              <label className={labelClass}>Product Name *</label>
              <input
                className={inputClass}
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Romantic Candlelight Dinner"
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className={labelClass}>Category *</label>
                <div className="mt-1 flex items-end gap-2">
                  <select
                    className={`${inputClass} mt-0 flex-1`}
                    value={form.categoryId}
                    onChange={(e) => {
                      const catId = e.target.value;
                      setForm((f) => ({ ...f, categoryId: catId, subcategory: "" }));
                    }}
                  >
                    <option value="">Select Category</option>
                    {categories.map((cat) => (
                      <option key={cat._id} value={cat._id}>
                        {cat.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className={ghostBtnClass}
                    onClick={() => setShowAddCategoryModal(true)}
                    title="Add new category"
                  >
                    + New
                  </button>
                </div>
              </div>

              <div>
                <label className={labelClass}>Subcategory</label>
                <select
                  className={inputClass}
                  value={form.subcategory}
                  onChange={(e) => setForm((f) => ({ ...f, subcategory: e.target.value }))}
                  disabled={!form.categoryId}
                >
                  <option value="">Select Subcategory</option>
                  {getSubcategories().map((sub) => (
                    <option key={sub} value={sub}>
                      {sub}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className={labelClass}>Price (&#8377;) *</label>
                <input
                  type="number"
                  className={inputClass}
                  value={form.price}
                  onChange={(e) => setForm((f) => ({ ...f, price: Number(e.target.value) }))}
                  min="0"
                />
              </div>

              <div>
                <label className={labelClass}>Original Price (&#8377;)</label>
                <input
                  type="number"
                  className={inputClass}
                  value={form.originalPrice}
                  onChange={(e) => setForm((f) => ({ ...f, originalPrice: Number(e.target.value) }))}
                  min="0"
                />
              </div>
            </div>

            <div>
              <label className={labelClass}>Description</label>
              <textarea
                className={inputClass}
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                rows={4}
                placeholder="Describe your product..."
              />
            </div>

            <div>
              <label className={labelClass}>Main Image *</label>
              <div className="mt-1">{imageModeTabs(imageMode, setImageMode)}</div>

              {imageMode === "upload" ? (
                <div
                  className={`mt-2 ${dropzoneClass}`}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={handleImageDrop}
                >
                  <input
                    type="file"
                    id="product-image-upload"
                    accept="image/*"
                    onChange={handleFileUpload}
                    className="hidden"
                    disabled={uploading}
                  />
                  <label htmlFor="product-image-upload" className="flex cursor-pointer flex-col items-center gap-1 text-[#381932] dark:text-[#381932]">
                    {uploading ? (
                      <span className="text-xs font-bold">Uploading...</span>
                    ) : (
                      <>
                        <Upload size={20} />
                        <span className="text-xs font-bold">
                          {form.image ? "Change Image" : "Choose Image"}
                        </span>
                        <span className="text-[10px] font-semibold opacity-70">Drag & drop or browse · Max 4MB</span>
                      </>
                    )}
                  </label>
                </div>
              ) : (
                <input
                  className={inputClass}
                  value={form.image}
                  onChange={(e) => setForm((f) => ({ ...f, image: e.target.value }))}
                  placeholder="https://example.com/image.jpg"
                />
              )}

              {form.image && !uploading && (
                <div className="relative mt-2 h-44 w-full overflow-hidden rounded-2xl border border-[#381932] dark:border-[#381932]">
                  <img src={resolveImageUrl(form.image)} alt="Preview" className="h-full w-full object-cover" onError={handleImageError} />
                  <button
                    type="button"
                    className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-[#381932]/70 text-[#FFF3E6] cursor-pointer"
                    onClick={() => setForm((f) => ({ ...f, image: "" }))}
                    title="Remove image"
                  >
                    <X size={14} />
                  </button>
                </div>
              )}
            </div>

            <div>
              <label className={labelClass}>More Images</label>
              <div className="mt-1">{imageModeTabs(moreImagesMode, setMoreImagesMode)}</div>

              {moreImagesMode === "upload" ? (
                <div
                  className={`mt-2 ${dropzoneClass}`}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={handleMoreImagesDrop}
                >
                  <input
                    type="file"
                    id="more-images-upload"
                    accept="image/*"
                    onChange={handleMoreImagesUpload}
                    className="hidden"
                    disabled={moreUploading}
                  />
                  <label htmlFor="more-images-upload" className="flex cursor-pointer flex-col items-center gap-1 text-[#381932] dark:text-[#381932]">
                    {moreUploading ? (
                      <span className="text-xs font-bold">Uploading...</span>
                    ) : (
                      <>
                        <Upload size={20} />
                        <span className="text-xs font-bold">Add More Images</span>
                        <span className="text-[10px] font-semibold opacity-70">Drag & drop or browse · Max 4MB</span>
                      </>
                    )}
                  </label>
                </div>
              ) : (
                <div className="mt-1 flex gap-2">
                  <input
                    className={`${inputClass} mt-0 flex-1`}
                    placeholder="https://example.com/image.jpg"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && e.currentTarget.value.trim()) {
                        setForm((f) => ({
                          ...f,
                          moreImages: [...f.moreImages, e.currentTarget.value.trim()],
                        }));
                        e.currentTarget.value = "";
                      }
                    }}
                  />
                </div>
              )}
            </div>

            {form.moreImages.length > 0 && (
              <div className="mt-2 grid grid-cols-4 gap-2 sm:grid-cols-6">
                {form.moreImages.map((img, idx) => (
                  <div key={idx} className="group relative aspect-square overflow-hidden rounded-lg border border-[#381932] dark:border-[#381932]">
                    <img src={resolveImageUrl(img)} alt={`More ${idx + 1}`} className="h-full w-full object-cover" onError={handleImageError} />
                    <button
                      type="button"
                      className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-[#381932]/60 text-[#FFF3E6] opacity-0 transition-opacity group-hover:opacity-100"
                      onClick={() => removeMoreImage(idx)}
                      title="Remove"
                    >
                      <X size={11} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div>
              <label className={labelClass}>Inclusions</label>
              <div className="mt-1 flex gap-2">
                <input
                  className={`${inputClass} mt-0 flex-1`}
                  value={newInclusion}
                  onChange={(e) => setNewInclusion(e.target.value)}
                  placeholder="e.g. Cake, Balloons, Decorations"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addInclusion();
                    }
                  }}
                />
                <button type="button" className={ghostBtnClass} onClick={addInclusion}>
                  + Add
                </button>
              </div>
            </div>
            {form.inclusions.length > 0 && (
              <ul className="mt-2 flex flex-col gap-1.5">
                {form.inclusions.map((inc, idx) => (
                  <li key={idx} className="flex items-center justify-between rounded-lg bg-[#FFF3E6] dark:bg-[#381932] border border-[#381932] dark:border-[#381932] px-3 py-1.5 text-sm text-[#381932] dark:text-[#FFF3E6]">
                    {inc}
                    <button type="button" className="text-[#381932] dark:text-[#381932] hover:text-[#381932] dark:hover:text-[#381932]" onClick={() => removeInclusion(idx)}>
                      <X size={13} />
                    </button>
                  </li>
                ))}
              </ul>
            )}



            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className={labelClass}>Badge Text</label>
                <input
                  className={inputClass}
                  value={form.badge}
                  onChange={(e) => setForm((f) => ({ ...f, badge: e.target.value }))}
                  placeholder="e.g. BESTSELLER"
                />
              </div>

              <div>
                <label className={labelClass}>Badge Color</label>
                <select
                  className={inputClass}
                  value={form.badgeColor}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      badgeColor: e.target.value,
                    }))
                  }
                >
                  {BADGE_COLORS.map(c => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex gap-4">
              <label className="flex items-center gap-2 text-xs font-bold text-[#381932] dark:text-[#381932]">
                <input
                  type="checkbox"
                  checked={form.active}
                  onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
                />
                Active
              </label>
              <label className="flex items-center gap-2 text-xs font-bold text-[#381932] dark:text-[#381932]">
                <input
                  type="checkbox"
                  checked={form.featured}
                  onChange={(e) => setForm((f) => ({ ...f, featured: e.target.checked }))}
                />
                Featured
              </label>
            </div>

            <div className={footerClass}>
              <button className={ghostBtnClass} onClick={() => setShowModal(false)}>
                Cancel
              </button>
              <button className={primaryBtnClass} onClick={save} disabled={uploading || moreUploading}>
                {editing ? "Save Changes" : "Add Product"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {deleteConfirm && (
        <ConfirmModal
          title="Delete Product"
          message={`Are you sure you want to delete "${deleteConfirm.name}"? This action cannot be undone.`}
          onConfirm={() => del(deleteConfirm.id)}
          onCancel={() => setDeleteConfirm(null)}
          confirmText="Delete"
        />
      )}

      {showAddCategoryModal && (
        <Modal
          title="Add New Category"
          onClose={() => {
            setShowAddCategoryModal(false);
            setNewCategoryName("");
          }}
        >
          <div className="flex flex-col gap-4">
            <div>
              <label className={labelClass}>Category Name *</label>
              <input
                className={inputClass}
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                placeholder="e.g. Birthday Decorations"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addNewCategory();
                  }
                }}
              />
            </div>
            <p className="flex items-start gap-1.5 text-xs text-[#381932] dark:text-[#381932]">
              <Lightbulb size={13} className="mt-0.5 flex-shrink-0 text-[#381932] dark:text-[#381932]" />
              Quick add: Category will be created with default settings. You can edit it later from the Categories page.
            </p>
            <div className={footerClass}>
              <button
                className={ghostBtnClass}
                onClick={() => {
                  setShowAddCategoryModal(false);
                  setNewCategoryName("");
                }}
              >
                Cancel
              </button>
              <button className={primaryBtnClass} onClick={addNewCategory}>
                Add Category
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
