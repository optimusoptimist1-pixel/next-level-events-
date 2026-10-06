import { useState, useEffect } from "react";
import type { AdminCategory } from "../../types";
import { Modal } from "./Modal";
import { ConfirmModal } from "./ConfirmModal";
import { toast } from "react-toastify";
import { Pencil, Eye, EyeOff, Trash2, Layers, Plus, Upload, Link as LinkIcon, X, Copy, ArrowUp, ArrowDown } from "lucide-react";
import { EmptyState } from "../EmptyState";
import { cn } from "../../lib/utils";
import { getApiUrl, authFetch, parseJsonSafe } from '../../lib/api';
import { supabase } from '../../lib/supabase';
import { resolveImageUrl, handleImageError } from '../../lib/imageUrl';
import { UPLOAD_URL } from '../../lib/uploads';
import { compressImage } from '../../lib/imageCompress';
import { trackAdminAction } from '../../lib/analytics';
import { broadcastCrmUpdate } from '../../lib/syncChannel';

const getCategoriesApi = () => getApiUrl('/api/categories');
const API = { toString: getCategoriesApi, valueOf: getCategoriesApi, [Symbol.toPrimitive]: getCategoriesApi } as unknown as string;

export const CategoriesView = () => {
  const [cats, setCats] = useState<AdminCategory[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<AdminCategory | null>(null);
  const [showSubsModal, setShowSubsModal] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<AdminCategory | null>(null);
  const [showAddSubModal, setShowAddSubModal] = useState(false);
  const [newSubName, setNewSubName] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; name: string } | null>(null);
  const [deleteSubConfirm, setDeleteSubConfirm] = useState<{ idx: number; name: string } | null>(null);
  const [editSubModal, setEditSubModal] = useState<{ idx: number; name: string } | null>(null);
  const [editSubName, setEditSubName] = useState('');
  const [imageMode, setImageMode] = useState<"url" | "upload">("upload");
  const [uploading, setUploading] = useState(false);
  const [subImageMode, setSubImageMode] = useState<"url" | "upload">("upload");
  const [subUploading, setSubUploading] = useState(false);
  const [subImage, setSubImage] = useState("");

  const [form, setForm] = useState({
    name: "",
    icon: "",
    image: "",
    slug: "",
    active: true,
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

  const moveCategory = async (index: number, direction: 'up' | 'down') => {
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= cats.length) return;

    const newCats = [...cats];
    const temp = newCats[index];
    newCats[index] = newCats[targetIndex];
    newCats[targetIndex] = temp;

    setCats(newCats);

    try {
      const orderedIds = newCats.map((c) => String(c._id || (c as any).id || '')).filter(Boolean);
      const res = await authFetch(`${API}/reorder`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderedIds }),
      });

      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        console.error("Category reorder API failed:", res.status, payload);
        throw new Error(payload?.error || "Failed to reorder");
      }
      trackAdminAction('reorder_categories', 'category');
      broadcastCrmUpdate('category');
      toast.success("Category position updated!");
    } catch (err: any) {
      console.error("Category move error:", err);
      toast.error("Failed to update category order");
      fetchCategories();
    }
  };

  const addSubcategory = async (categoryId: string) => {
    if (!newSubName.trim()) {
      toast.error("Please enter subcategory name");
      return;
    }

    if (!subImage.trim()) {
      toast.error("Please add subcategory image");
      return;
    }

    const category = cats.find((c) => c._id === categoryId);
    const updatedSubs = [...(category?.subcategories || []), { name: newSubName.trim(), image: subImage }];

    const res = await authFetch(`${API}/${categoryId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subcategories: updatedSubs }),
    });

    const updated = await res.json();
    setCats((prev) => prev.map((cat) => (cat._id === updated._id ? updated : cat)));

    if (selectedCategory && selectedCategory._id === categoryId) {
      setSelectedCategory(updated);
    }

    setNewSubName("");
    setSubImage("");
    setShowAddSubModal(false);
    broadcastCrmUpdate('category', categoryId);
    toast.success("Subcategory added!");
  };

  const editSubcategory = async () => {
    if (!editSubName.trim() || !selectedCategory || editSubModal === null) {
      toast.error("Please enter subcategory name");
      return;
    }

    if (!subImage.trim()) {
      toast.error("Please add subcategory image");
      return;
    }

    const updatedSubs = [...(selectedCategory.subcategories || [])];
    updatedSubs[editSubModal.idx] = { name: editSubName.trim(), image: subImage };

    const res = await authFetch(`${API}/${selectedCategory._id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subcategories: updatedSubs }),
    });

    const updated = await res.json();
    setCats((prev) => prev.map((cat) => (cat._id === updated._id ? updated : cat)));
    setSelectedCategory(updated);
    setEditSubModal(null);
    setEditSubName("");
    setSubImage("");
    broadcastCrmUpdate('category', selectedCategory._id);
    toast.success("Subcategory updated!");
  };

  const fetchCategories = async () => {
    try {
      const res = await authFetch(getCategoriesApi());
      const parsed = await parseJsonSafe<AdminCategory[]>(res);
      if (parsed.ok && Array.isArray(parsed.data)) {
        setCats(parsed.data);
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
        setCats(mapped);
        return;
      }
    } catch {
      toast.error("Failed to load categories");
    }
  };

  useEffect(() => {
    fetchCategories();
  }, []);

  const openAdd = () => {
    setEditing(null);
    setForm({ name: "", icon: "", image: "", slug: "", active: true });
    setImageMode("upload");
    setShowModal(true);
  };

  const openEdit = (c: AdminCategory) => {
    setEditing(c);
    setForm({ name: c.name, icon: "", image: c.image || "", slug: c.slug, active: c.active });
    setImageMode("upload");
    setShowModal(true);
  };

  const uploadCategoryImageFile = async (file: File) => {
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
    formData.append("folder", "ems/categories");

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
    await uploadCategoryImageFile(file);
    e.target.value = "";
  };

  const handleCategoryDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    await uploadCategoryImageFile(file);
  };

  const uploadSubImageFile = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error("Please upload an image file");
      return;
    }

    setSubUploading(true);
    const compressed = await compressImage(file);
    if (compressed.size > 4 * 1024 * 1024) {
      toast.error("Image is still over 4MB after compression");
      setSubUploading(false);
      return;
    }
    const formData = new FormData();
    formData.append("file", compressed);
    formData.append("folder", "ems/subcategories");

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
      setSubImage(data.secure_url);
      toast.success("Image uploaded successfully!");
    } catch (error) {
      toast.error("Failed to upload image. Please try again.");
      console.error("Upload error:", error);
    } finally {
      setSubUploading(false);
    }
  };

  const handleSubFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await uploadSubImageFile(file);
    e.target.value = "";
  };

  const handleSubDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    await uploadSubImageFile(file);
  };

  const save = async () => {
    if (!form.name.trim()) {
      toast.error("Category name is required");
      return;
    }

    if (!form.image.trim()) {
      toast.error("Category image is required");
      return;
    }

    const exists = cats.some(
      (c) => c.name.toLowerCase() === form.name.toLowerCase() && c._id !== editing?._id
    );

    if (!editing && exists) {
      toast.error("Category already exists!");
      return;
    }

    if (editing) {
      try {
        const res = await authFetch(`${API}/${editing._id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        });
        const updated = await res.json();
        setCats((prev) => prev.map((cat) => (cat._id === updated._id ? updated : cat)));
        trackAdminAction('update_category', 'category', updated._id);
        broadcastCrmUpdate('category', updated._id);
        toast.success("Category updated successfully!");
      } catch {
        toast.error("Failed to update category");
      }
    } else {
      const res = await authFetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const newCategory = await res.json();
      setCats((prev) => [...prev, newCategory]);
      trackAdminAction('create_category', 'category', newCategory._id);
      broadcastCrmUpdate('category', newCategory._id);
      toast.success("Category added successfully!");
    }

    setShowModal(false);
  };

  const del = async (id: string) => {
    await authFetch(`${API}/${id}`, { method: "DELETE" });
    setCats((prev) => prev.filter((cat) => cat._id !== id));
    setDeleteConfirm(null);
    trackAdminAction('delete_category', 'category', id);
    broadcastCrmUpdate('category', id);
    toast.success("Category deleted!");
  };

  const toggle = async (id: string, active: boolean) => {
    await authFetch(`${API}/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active }),
    });
    setCats((prev) => prev.map((cat) => (cat._id === id ? { ...cat, active } : cat)));
    broadcastCrmUpdate('category', id);
  };

  const imageModeTabs = (mode: "url" | "upload", setMode: (m: "url" | "upload") => void) => (
    <div className="flex gap-2 border-b border-[#381932] dark:border-[#381932] pb-2">
      <button
        type="button"
        className={`rounded-xl px-3 py-1.5 text-xs font-bold transition-all cursor-pointer ${mode === "upload" ? "bg-[#381932] text-[#FFF3E6]" : "bg-[#FFF3E6] dark:bg-[#381932] text-[#381932] dark:text-[#381932]"}`}
        onClick={() => setMode("upload")}
      >
        <Upload size={13} className="mr-1 inline" /> Upload File
      </button>
      <button
        type="button"
        className={`rounded-xl px-3 py-1.5 text-xs font-bold transition-all cursor-pointer ${mode === "url" ? "bg-[#381932] text-[#FFF3E6]" : "bg-[#FFF3E6] dark:bg-[#381932] text-[#381932] dark:text-[#381932]"}`}
        onClick={() => setMode("url")}
      >
        <LinkIcon size={13} className="mr-1 inline" /> Image URL
      </button>
    </div>
  );

  const labelClass = "text-xs font-extrabold uppercase text-[#381932] dark:text-[#381932]";
  const inputClass = "mt-1 w-full rounded-xl border border-[#381932] dark:border-[#381932] bg-[#FFF3E6] dark:bg-[#381932] px-3.5 py-2.5 text-xs font-semibold text-[#381932] dark:text-[#FFF3E6] outline-none";
  const dropzoneClass = "rounded-2xl border-2 border-dashed border-[#381932] dark:border-[#381932] p-6 text-center bg-[#FFF3E6]/50 dark:bg-[#381932]/40";
  const footerClass = "flex items-center justify-end gap-3 border-t border-[#381932] dark:border-[#381932] pt-4";
  const ghostBtnClass = "rounded-xl border border-[#381932] dark:border-[#381932] px-4 py-2.5 text-xs font-bold text-[#381932] dark:text-[#381932] cursor-pointer";
  const primaryBtnClass = "rounded-xl bg-[#381932] text-[#FFF3E6] px-4 py-2.5 text-xs font-bold shadow-md shadow-[#381932]/20 disabled:opacity-60 cursor-pointer";

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-2xl border border-[#381932] dark:border-[#381932] bg-[#FFF3E6] dark:bg-[#381932] p-5 shadow-xs">
        <div>
          <h2 className="text-xl font-black text-[#381932] dark:text-[#FFF3E6]">Product Categories</h2>
          <p className="text-xs font-semibold text-[#381932] dark:text-[#381932] mt-0.5">Organize party themes, decor types, and event subcategories.</p>
        </div>
        <button 
          type="button" 
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#381932] hover:opacity-90 text-[#FFF3E6] px-4 py-2.5 text-xs font-bold shadow-md shadow-[#381932]/20 active:scale-95 transition-all cursor-pointer" 
          onClick={openAdd}
        >
          + Add Category
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {cats.map((cat, idx) => (
          <div key={cat._id} className={cn('overflow-hidden rounded-2xl border border-[#381932] dark:border-[#381932] bg-[#FFF3E6] dark:bg-[#381932] shadow-xs flex flex-col justify-between transition-all', !cat.active && 'opacity-60')}>
            <div>
              <div className="relative aspect-video w-full bg-[#FFF3E6] dark:bg-[#381932] overflow-hidden">
                {cat.image ? (
                  <img src={resolveImageUrl(cat.image)} alt={cat.name} className="h-full w-full object-cover" onError={handleImageError} />
                ) : (
                  <div className="h-full w-full flex items-center justify-center text-xs font-semibold text-[#381932]">No Image</div>
                )}
                <span className="absolute top-2.5 left-2.5 rounded-full bg-[#381932]/80 backdrop-blur-md px-2.5 py-0.5 text-[10px] font-extrabold text-[#FFF3E6] border border-[#381932]/20">
                  #{idx + 1}
                </span>
                <span className={`absolute top-2.5 right-2.5 rounded-full px-2.5 py-0.5 text-[10px] font-extrabold uppercase border ${
                  cat.active ? 'bg-[#FFF3E6] dark:bg-[#381932]/80 text-[#381932] dark:text-[#381932] border-[#381932] dark:border-[#381932]' : 'bg-[#FFF3E6] dark:bg-[#381932] text-[#381932] border-[#381932] dark:border-[#381932]'
                }`}>
                  {cat.active ? 'Active' : 'Hidden'}
                </span>
              </div>
              <div className="p-4 space-y-1">
                <div className="text-sm font-bold text-[#381932] dark:text-[#FFF3E6]">{cat.name}</div>
                <div className="text-[11px] font-semibold text-[#381932] dark:text-[#381932]">{cat.productCount || 0} products &middot; /{cat.slug}</div>
              </div>
            </div>

            <div className="p-4 pt-0 space-y-2">
              <div className="flex flex-wrap gap-1.5">
                <button type="button" className="inline-flex items-center gap-1 rounded-xl border border-[#381932] dark:border-[#381932] bg-[#FFF3E6] dark:bg-[#381932] px-2.5 py-1.5 text-xs font-bold text-[#381932] dark:text-[#381932] hover:bg-[#FFF3E6] dark:hover:bg-[#381932] transition-colors cursor-pointer" onClick={() => openEdit(cat)}>
                  <Pencil size={12} /> Edit
                </button>
                <button type="button" className="inline-flex items-center gap-1 rounded-xl border border-[#381932] dark:border-[#381932] bg-[#FFF3E6] dark:bg-[#381932] px-2.5 py-1.5 text-xs font-bold text-[#381932] dark:text-[#381932] hover:bg-[#FFF3E6] dark:hover:bg-[#381932] transition-colors cursor-pointer" onClick={() => toggle(cat._id, !cat.active)}>
                  {cat.active ? <EyeOff size={12} /> : <Eye size={12} />} {cat.active ? "Hide" : "Show"}
                </button>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-xl border border-[#381932] dark:border-[#381932]/50 bg-[#FFF3E6] dark:bg-[#381932]/40 px-2.5 py-1.5 text-xs font-bold text-[#381932] dark:text-[#381932] hover:bg-[#FFF3E6] cursor-pointer"
                  onClick={() => setDeleteConfirm({ id: cat._id, name: cat.name })}
                >
                  <Trash2 size={12} />
                </button>
                <div className="ml-auto flex items-center gap-1">
                  <button
                    type="button"
                    disabled={idx === 0}
                    onClick={() => moveCategory(idx, 'up')}
                    className="flex h-7 w-7 items-center justify-center rounded-lg border border-[#381932] dark:border-[#381932] bg-[#FFF3E6] dark:bg-[#381932] text-[#381932] dark:text-[#381932] hover:bg-[#FFF3E6] dark:hover:bg-[#381932] disabled:opacity-30 cursor-pointer"
                    title="Move Up"
                  >
                    <ArrowUp size={13} />
                  </button>
                  <button
                    type="button"
                    disabled={idx === cats.length - 1}
                    onClick={() => moveCategory(idx, 'down')}
                    className="flex h-7 w-7 items-center justify-center rounded-lg border border-[#381932] dark:border-[#381932] bg-[#FFF3E6] dark:bg-[#381932] text-[#381932] dark:text-[#381932] hover:bg-[#FFF3E6] dark:hover:bg-[#381932] disabled:opacity-30 cursor-pointer"
                    title="Move Down"
                  >
                    <ArrowDown size={13} />
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-1.5 border-t border-[#381932] dark:border-[#381932] pt-2.5">
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-xl border border-[#381932] dark:border-[#381932] bg-[#FFF3E6] dark:bg-[#381932]/50 px-2.5 py-1.5 text-[11px] font-bold text-[#381932] dark:text-[#381932] hover:bg-[#FFF3E6] cursor-pointer"
                  onClick={() => { setSelectedCategory(cat); setShowSubsModal(true); }}
                >
                  <Layers size={12} /> Subs ({cat.subcategories?.length || 0})
                </button>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-xl border border-[#381932] dark:border-[#381932] bg-[#FFF3E6] dark:bg-[#381932] px-2.5 py-1.5 text-[11px] font-bold text-[#381932] dark:text-[#381932] hover:bg-[#FFF3E6] cursor-pointer"
                  onClick={() => { setSelectedCategory(cat); setShowAddSubModal(true); }}
                >
                  <Plus size={12} /> Add Sub
                </button>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-xl border border-[#381932] dark:border-[#381932] bg-[#FFF3E6] dark:bg-[#381932] px-2 py-1.5 text-[11px] font-bold text-[#381932] dark:text-[#381932] hover:bg-[#FFF3E6] cursor-pointer"
                  onClick={() => copyToClipboard(`/category/${encodeURIComponent(cat.name)}`)}
                  title="Copy Category Route Link"
                >
                  <Copy size={12} />
                </button>
              </div>
            </div>
          </div>
        ))}

        {cats.length === 0 && (
          <div className="col-span-full">
            <EmptyState title="No categories yet" description='Click "+ Add Category" to create your first one.' />
          </div>
        )}
      </div>

      {showModal && (
        <Modal title={editing ? "Edit Category" : "Add Category"} onClose={() => setShowModal(false)}>
          <div className="space-y-4">
            <div>
              <label className={labelClass}>Category Name *</label>
              <input
                className={inputClass}
                value={form.name}
                onChange={(e) => {
                  const name = e.target.value;
                  setForm((f) => ({ ...f, name, slug: name.toLowerCase().replace(/\s+/g, "-") }));
                }}
              />
            </div>

            <div className="space-y-2">
              <label className={labelClass}>Category Image *</label>
              {imageModeTabs(imageMode, setImageMode)}

              {imageMode === "upload" ? (
                <div
                  className={dropzoneClass}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={handleCategoryDrop}
                >
                  <input
                    type="file"
                    id="cat-image-upload"
                    accept="image/*"
                    onChange={handleFileUpload}
                    className="hidden"
                    disabled={uploading}
                  />
                  <label htmlFor="cat-image-upload" className="cursor-pointer space-y-1 block">
                    {uploading ? (
                      <div className="text-xs font-bold text-[#381932]">Uploading...</div>
                    ) : (
                      <>
                        <div className="flex justify-center text-[#381932] mb-2"><Upload size={24} /></div>
                        <div className="text-xs font-bold text-[#381932] dark:text-[#FFF3E6]">
                          {form.image ? "Change Image" : "Choose Image"}
                        </div>
                        <div className="text-[10px] text-[#381932] font-semibold">Drag &amp; drop or browse · Max 4MB</div>
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
                <div className="relative">
                  <img src={resolveImageUrl(form.image)} alt="Preview" className="h-44 w-full rounded-xl object-cover border border-[#381932] dark:border-[#381932]" onError={handleImageError} />
                  <button
                    type="button"
                    className="absolute top-2 right-2 flex h-7 w-7 items-center justify-center rounded-full bg-[#381932] text-[#FFF3E6] cursor-pointer"
                    onClick={() => setForm((f) => ({ ...f, image: "" }))}
                    title="Remove image"
                  >
                    <X size={14} />
                  </button>
                </div>
              )}
            </div>

            <div>
              <label className={labelClass}>Slug</label>
              <input
                className={inputClass}
                value={form.slug}
                onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value.toLowerCase().replace(/\s+/g, "-") }))}
              />
            </div>

            <label className="flex items-center gap-2 text-xs font-bold text-[#381932] dark:text-[#FFF3E6] cursor-pointer">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
                className="accent-[#381932]"
              />
              Active
            </label>

            <div className={footerClass}>
              <button type="button" className={ghostBtnClass} onClick={() => setShowModal(false)}>
                Cancel
              </button>
              <button type="button" className={primaryBtnClass} onClick={save} disabled={uploading}>
                {editing ? "Save Changes" : "Add Category"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {showSubsModal && selectedCategory && (
        <Modal
          title={`Subcategories - ${selectedCategory.name}`}
          onClose={() => {
            setShowSubsModal(false);
            setSelectedCategory(null);
          }}
        >
          <div className="flex flex-col gap-4">
            {selectedCategory.subcategories && selectedCategory.subcategories.length > 0 ? (
              <div className="flex flex-col gap-2">
                {selectedCategory.subcategories.map((sub, idx) => {
                  const subName = typeof sub === 'string' ? sub : sub.name;
                  const subImg = typeof sub === 'string' ? '' : sub.image;

                  return (
                    <div key={idx} className="flex items-center gap-2.5 rounded-lg border border-[#381932] dark:border-[#381932] p-2">
                      <span className="w-5 flex-shrink-0 text-xs text-[#381932] dark:text-[#381932]">{idx + 1}.</span>
                      {subImg && (
                        <div className="h-10 w-10 flex-shrink-0 overflow-hidden rounded-md bg-[#FFF3E6] dark:bg-[#381932]">
                          <img src={resolveImageUrl(subImg)} alt={subName} className="h-full w-full object-cover" onError={handleImageError} />
                        </div>
                      )}
                      <span className="flex-1 truncate text-sm font-medium text-[#381932] dark:text-[#FFF3E6]">{subName}</span>
                      <div className="flex flex-shrink-0 gap-1.5">
                        <button
                          className="flex h-7 w-7 items-center justify-center rounded-md border border-[#381932] dark:border-[#381932] text-[#381932] dark:text-[#381932] hover:bg-[#FFF3E6] dark:hover:bg-[#381932] cursor-pointer"
                          onClick={() => {
                            setEditSubModal({ idx, name: subName });
                            setEditSubName(subName);
                            setSubImage(subImg || "");
                          }}
                        >
                          <Pencil size={12} />
                        </button>
                        <button
                          className="flex h-7 w-7 items-center justify-center rounded-md border border-[#381932] dark:border-[#381932]/50 text-[#381932] dark:text-[#381932] hover:bg-[#FFF3E6] dark:hover:bg-[#381932]/40 cursor-pointer"
                          onClick={() => setDeleteSubConfirm({ idx, name: subName })}
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <EmptyState title="No subcategories yet" description='Click "+ Add Subcategory" to add one.' />
            )}
            <div className={footerClass}>
              <button type="button" className={primaryBtnClass} onClick={() => setShowAddSubModal(true)}>
                + Add Subcategory
              </button>
            </div>
          </div>
        </Modal>
      )}

      {showAddSubModal && selectedCategory && (
        <Modal
          title="Add Subcategory"
          onClose={() => {
            setShowAddSubModal(false);
            setNewSubName("");
            setSubImage("");
          }}
        >
          <div className="space-y-4">
            <div className="flex items-center gap-2 rounded-lg bg-[#FFF3E6] dark:bg-[#381932]/60 p-2.5 border border-[#381932] dark:border-[#381932]">
              <span className="text-xs font-medium text-[#381932] dark:text-[#381932]">Adding to:</span>
              <div className="flex items-center gap-1.5">
                {selectedCategory.image ? (
                  <img src={resolveImageUrl(selectedCategory.image)} alt={selectedCategory.name} className="h-6 w-6 rounded-md object-cover" onError={handleImageError} />
                ) : (
                  <span>{selectedCategory.icon}</span>
                )}
                <span className="text-sm font-semibold text-[#381932] dark:text-[#FFF3E6]">{selectedCategory.name}</span>
              </div>
            </div>

            <div>
              <label className={labelClass}>Subcategory Name *</label>
              <input
                className={inputClass}
                value={newSubName}
                onChange={(e) => setNewSubName(e.target.value)}
                placeholder="e.g. Balloon Decorations"
                autoFocus
              />
            </div>

            <div className="space-y-2">
              <label className={labelClass}>Subcategory Image *</label>
              {imageModeTabs(subImageMode, setSubImageMode)}

              {subImageMode === "upload" ? (
                <div
                  className={dropzoneClass}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={handleSubDrop}
                >
                  <input
                    type="file"
                    id="sub-image-upload"
                    accept="image/*"
                    onChange={handleSubFileUpload}
                    className="hidden"
                    disabled={subUploading}
                  />
                  <label htmlFor="sub-image-upload" className="cursor-pointer space-y-1 block">
                    {subUploading ? (
                      <div className="text-xs font-bold text-[#381932]">Uploading...</div>
                    ) : (
                      <>
                        <div className="flex justify-center text-[#381932] mb-2"><Upload size={24} /></div>
                        <div className="text-xs font-bold text-[#381932] dark:text-[#FFF3E6]">
                          {subImage ? "Change Image" : "Choose Image"}
                        </div>
                        <div className="text-[10px] text-[#381932] font-semibold">Drag &amp; drop or browse · Max 4MB</div>
                      </>
                    )}
                  </label>
                </div>
              ) : (
                <input
                  className={inputClass}
                  value={subImage}
                  onChange={(e) => setSubImage(e.target.value)}
                  placeholder="https://example.com/image.jpg"
                />
              )}

              {subImage && !subUploading && (
                <div className="relative">
                  <img src={resolveImageUrl(subImage)} alt="Preview" className="h-44 w-full rounded-xl object-cover border border-[#381932] dark:border-[#381932]" onError={handleImageError} />
                  <button
                    type="button"
                    className="absolute top-2 right-2 flex h-7 w-7 items-center justify-center rounded-full bg-[#381932] text-[#FFF3E6] cursor-pointer"
                    onClick={() => setSubImage("")}
                    title="Remove image"
                  >
                    <X size={14} />
                  </button>
                </div>
              )}
            </div>

            <div className={footerClass}>
              <button
                type="button"
                className={ghostBtnClass}
                onClick={() => {
                  setShowAddSubModal(false);
                  setNewSubName("");
                  setSubImage("");
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className={primaryBtnClass}
                onClick={() => addSubcategory(selectedCategory._id)}
                disabled={subUploading}
              >
                Add Subcategory
              </button>
            </div>
          </div>
        </Modal>
      )}

      {editSubModal && selectedCategory && (
        <Modal
          title="Edit Subcategory"
          onClose={() => {
            setEditSubModal(null);
            setEditSubName("");
            setSubImage("");
          }}
        >
          <div className="space-y-4">
            <div className="flex items-center gap-2 rounded-lg bg-[#FFF3E6] dark:bg-[#381932]/60 p-2.5 border border-[#381932] dark:border-[#381932]">
              <span className="text-xs font-medium text-[#381932] dark:text-[#381932]">Category:</span>
              <div className="flex items-center gap-1.5">
                {selectedCategory.image ? (
                  <img src={resolveImageUrl(selectedCategory.image)} alt={selectedCategory.name} className="h-6 w-6 rounded-md object-cover" onError={handleImageError} />
                ) : (
                  <span>{selectedCategory.icon}</span>
                )}
                <span className="text-sm font-semibold text-[#381932] dark:text-[#FFF3E6]">{selectedCategory.name}</span>
              </div>
            </div>

            <div>
              <label className={labelClass}>Subcategory Name *</label>
              <input
                className={inputClass}
                value={editSubName}
                onChange={(e) => setEditSubName(e.target.value)}
                placeholder="e.g. Balloon Decorations"
                autoFocus
              />
            </div>

            <div className="space-y-2">
              <label className={labelClass}>Subcategory Image *</label>
              {imageModeTabs(subImageMode, setSubImageMode)}

              {subImageMode === "upload" ? (
                <div className={dropzoneClass}>
                  <input
                    type="file"
                    id="sub-image-upload-edit"
                    accept="image/*"
                    onChange={handleSubFileUpload}
                    className="hidden"
                    disabled={subUploading}
                  />
                  <label htmlFor="sub-image-upload-edit" className="cursor-pointer space-y-1 block">
                    {subUploading ? (
                      <div className="text-xs font-bold text-[#381932]">Uploading...</div>
                    ) : (
                      <>
                        <div className="flex justify-center text-[#381932] mb-2"><Upload size={24} /></div>
                        <div className="text-xs font-bold text-[#381932] dark:text-[#FFF3E6]">
                          {subImage ? "Change Image" : "Choose Image"}
                        </div>
                        <div className="text-[10px] text-[#381932] font-semibold">Max 4MB (JPG, PNG, WebP)</div>
                      </>
                    )}
                  </label>
                </div>
              ) : (
                <input
                  className={inputClass}
                  value={subImage}
                  onChange={(e) => setSubImage(e.target.value)}
                  placeholder="https://example.com/image.jpg"
                />
              )}

              {subImage && !subUploading && (
                <div className="relative">
                  <img src={resolveImageUrl(subImage)} alt="Preview" className="h-44 w-full rounded-xl object-cover border border-[#381932] dark:border-[#381932]" onError={handleImageError} />
                  <button
                    type="button"
                    className="absolute top-2 right-2 flex h-7 w-7 items-center justify-center rounded-full bg-[#381932] text-[#FFF3E6] cursor-pointer"
                    onClick={() => setSubImage("")}
                    title="Remove image"
                  >
                    <X size={14} />
                  </button>
                </div>
              )}
            </div>

            <div className={footerClass}>
              <button
                type="button"
                className={ghostBtnClass}
                onClick={() => {
                  setEditSubModal(null);
                  setEditSubName("");
                  setSubImage("");
                }}
              >
                Cancel
              </button>
              <button type="button" className={primaryBtnClass} onClick={editSubcategory} disabled={subUploading}>
                Save Changes
              </button>
            </div>
          </div>
        </Modal>
      )}

      {deleteConfirm && (
        <ConfirmModal
          title="Delete Category"
          message={`Are you sure you want to delete "${deleteConfirm.name}"? This action cannot be undone.`}
          onConfirm={() => del(deleteConfirm.id)}
          onCancel={() => setDeleteConfirm(null)}
          confirmText="Delete"
        />
      )}

      {deleteSubConfirm && selectedCategory && (
        <ConfirmModal
          title="Delete Subcategory"
          message={`Are you sure you want to delete "${deleteSubConfirm.name}"?`}
          onConfirm={async () => {
            const updated = selectedCategory.subcategories?.filter((_, i) => i !== deleteSubConfirm.idx) || [];
            await authFetch(`${API}/${selectedCategory._id}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ subcategories: updated }),
            });
            setCats((prev) =>
              prev.map((cat) => (cat._id === selectedCategory._id ? { ...cat, subcategories: updated } : cat))
            );
            setSelectedCategory({ ...selectedCategory, subcategories: updated });
            setDeleteSubConfirm(null);
            toast.success("Subcategory deleted!");
          }}
          onCancel={() => setDeleteSubConfirm(null)}
          confirmText="Delete"
        />
      )}
    </div>
  );
};
