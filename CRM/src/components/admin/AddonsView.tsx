import { useEffect, useMemo, useState } from 'react';
import { toast } from 'react-toastify';
import { Eye, EyeOff, Pencil, Search, Trash2, Upload, Link as LinkIcon } from 'lucide-react';
import { Modal } from './Modal';
import { ConfirmModal } from './ConfirmModal';
import { cn } from '../../lib/utils';
import { getApiUrl, authFetch, parseJsonSafe } from '../../lib/api';
import { supabase } from '../../lib/supabase';
import { UPLOAD_URL } from '../../lib/uploads';
import { compressImage } from '../../lib/imageCompress';
import { resolveImageUrl, handleImageError } from '../../lib/imageUrl';
import type { AdminAddon } from '../../types';
import { broadcastCrmUpdate } from '../../lib/syncChannel';

const getAddonsApi = () => getApiUrl('/api/addons');
const API = { toString: getAddonsApi, valueOf: getAddonsApi, [Symbol.toPrimitive]: getAddonsApi } as unknown as string;
const PAGE_SIZE = 8;

export const AddonsView = () => {
  const [addons, setAddons] = useState<AdminAddon[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [page, setPage] = useState(1);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<AdminAddon | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; name: string } | null>(null);
  const [imageMode, setImageMode] = useState<'upload' | 'url'>('upload');
  const [uploading, setUploading] = useState(false);
  const [uploadedImage, setUploadedImage] = useState('');
  const [imageUrlInput, setImageUrlInput] = useState('');
  const [form, setForm] = useState({
    name: '',
    description: '',
    price: 0,
    image: '',
    active: true,
  });

  const fetchAddons = async () => {
    try {
      const res = await authFetch(getAddonsApi());
      const parsed = await parseJsonSafe<AdminAddon[]>(res);
      if (parsed.ok && Array.isArray(parsed.data)) {
        setAddons(parsed.data);
        return;
      }
    } catch {
      // Continue to Supabase direct fallback
    }

    try {
      const { data, error } = await supabase.from('addons').select('*').order('created_at', { ascending: false });
      if (!error && Array.isArray(data)) {
        setAddons(data.map((a: any) => ({
          _id: a.id || a._id,
          name: a.name,
          price: Number(a.price || 0),
          description: a.description || '',
          image: a.image || '',
          active: a.active ?? true,
          createdAt: a.created_at || new Date().toISOString(),
          updatedAt: a.updated_at || new Date().toISOString(),
        })));
        return;
      }
      throw new Error(error?.message || 'Failed to load add-ons');
    } catch {
      toast.error('Failed to load add-ons');
    }
  };

  useEffect(() => {
    void fetchAddons();
  }, []);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return addons.filter((addon) => {
      const matchesSearch = !query || [addon.name, addon.description, addon.category || '']
        .join(' ')
        .toLowerCase()
        .includes(query);

      const matchesStatus = statusFilter === 'all'
        ? true
        : statusFilter === 'active'
          ? addon.active
          : !addon.active;

      return matchesSearch && matchesStatus;
    });
  }, [addons, search, statusFilter]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const paged = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  useEffect(() => {
    setPage(1);
  }, [search, statusFilter]);

  const resetImageState = () => {
    setUploadedImage('');
    setImageUrlInput('');
    setImageMode('upload');
  };

  const isValidImageUrl = (value: string) => {
    // Site-relative paths ("/cabana.webp") are valid -- resolveImageUrl() handles them.
    if (/^\/[^/]/.test(value)) return true;
    try {
      const url = new URL(value);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  };

  const uploadImageFile = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      toast.error('Please upload an image file');
      return;
    }

    setUploading(true);
    const compressed = await compressImage(file);
    if (compressed.size > 4 * 1024 * 1024) {
      toast.error('Image is still over 4MB after compression');
      setUploading(false);
      return;
    }
    const formData = new FormData();
    formData.append('file', compressed);
    formData.append('folder', 'ems/addons');

    try {
      const response = await authFetch(UPLOAD_URL, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) throw new Error('Upload failed');

      const data = await response.json();
      setUploadedImage(data.secure_url);
      setForm((f) => ({ ...f, image: data.secure_url }));
      setImageUrlInput('');
      setImageMode('upload');
      toast.success('Image uploaded successfully!');
    } catch (error) {
      toast.error('Failed to upload image. Please try again.');
      console.error('Upload error:', error);
    } finally {
      setUploading(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await uploadImageFile(file);
    e.target.value = '';
  };

  const handleDropUpload = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    await uploadImageFile(file);
  };

  const openAdd = () => {
    setEditing(null);
    resetImageState();
    setForm({
      name: '',
      description: '',
      price: 0,
      image: '',
      active: true,
    });
    setShowModal(true);
  };

  const openEdit = (addon: AdminAddon) => {
    setEditing(addon);
    resetImageState();
    setForm({
      name: addon.name,
      description: addon.description,
      price: addon.price,
      image: addon.image,
      active: addon.active,
    });
    setUploadedImage(addon.image || '');
    setImageUrlInput(addon.image || '');
    setImageMode('upload');
    setShowModal(true);
  };

  const save = async () => {
    if (!form.name.trim()) {
      toast.error('Add-on name is required');
      return;
    }

    if (!form.price || form.price <= 0) {
      toast.error('Price must be greater than 0');
      return;
    }

    const finalImage = (uploadedImage || imageUrlInput.trim()).trim();
    if (!finalImage) {
      toast.error('Add-on image is required');
      return;
    }

    if (imageUrlInput.trim() && !isValidImageUrl(imageUrlInput.trim())) {
      toast.error('Please enter a valid image URL');
      return;
    }

    try {
      const payload = {
        ...form,
        name: form.name.trim(),
        description: form.description.trim(),
        image: finalImage,
      };

      if (editing) {
        const res = await authFetch(`${API}/${editing._id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const updated = await res.json();
        setAddons((prev) => prev.map((item) => item._id === updated._id ? updated : item));
        broadcastCrmUpdate('addon', updated._id);
        toast.success('Add-on updated');
      } else {
        const res = await authFetch(API, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const created = await res.json();
        setAddons((prev) => [created, ...prev]);
        broadcastCrmUpdate('addon', created._id);
        toast.success('Add-on created');
      }

      setShowModal(false);
      void fetchAddons();
    } catch {
      toast.error('Failed to save add-on');
    }
  };

  const del = async (id: string) => {
    try {
      await authFetch(`${API}/${id}`, { method: 'DELETE' });
      setAddons((prev) => prev.filter((item) => item._id !== id));
      setDeleteConfirm(null);
      broadcastCrmUpdate('addon', id);
      toast.success('Add-on deleted');
    } catch {
      toast.error('Failed to delete add-on');
    }
  };

  const toggle = async (id: string, active: boolean) => {
    try {
      await authFetch(`${API}/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active }),
      });
      setAddons((prev) => prev.map((item) => item._id === id ? { ...item, active } : item));
      broadcastCrmUpdate('addon', id);
    } catch {
      toast.error('Failed to update add-on status');
    }
  };

  const previewUrl = uploadedImage || imageUrlInput.trim();
  const previewIsValid = previewUrl ? isValidImageUrl(previewUrl) : false;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-2xl border border-[#381932] dark:border-[#381932] bg-[#FFF3E6] dark:bg-[#381932] p-5 shadow-xs">
        <div>
          <h2 className="text-xl font-black text-[#381932] dark:text-[#FFF3E6]">Product Add-ons</h2>
          <p className="text-xs font-semibold text-[#381932] dark:text-[#381932] mt-0.5">Manage extra decor elements (balloons, lights, props) for event packages.</p>
        </div>
        <button 
          type="button"
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#381932] hover:opacity-90 text-[#FFF3E6] px-4 py-2.5 text-xs font-bold shadow-md shadow-[#381932]/20 active:scale-95 transition-all cursor-pointer" 
          onClick={openAdd}
        >
          + Add Add-on
        </button>
      </div>

      <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="flex flex-col sm:flex-row items-center gap-2 w-full sm:max-w-xl">
          <div className="relative w-full">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#381932]" />
            <input
              className="w-full rounded-xl border border-[#381932] dark:border-[#381932] bg-[#FFF3E6] dark:bg-[#381932] pl-10 pr-4 py-2.5 text-xs font-semibold text-[#381932] dark:text-[#FFF3E6] outline-none placeholder:text-[#381932]"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search add-on title or category..."
            />
          </div>
          <select 
            className="w-full sm:w-40 rounded-xl border border-[#381932] dark:border-[#381932] bg-[#FFF3E6] dark:bg-[#381932] px-3 py-2.5 text-xs font-bold text-[#381932] dark:text-[#FFF3E6] outline-none" 
            value={statusFilter} 
            onChange={(e) => setStatusFilter(e.target.value as 'all' | 'active' | 'inactive')}
          >
            <option value="all">All Statuses</option>
            <option value="active">Active Only</option>
            <option value="inactive">Inactive Only</option>
          </select>
        </div>

        <div className="text-xs font-bold text-[#381932] dark:text-[#381932] self-end sm:self-center">
          {filtered.length} total add-ons
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {paged.map((addon) => (
          <div key={addon._id} className={cn('overflow-hidden rounded-2xl border border-[#381932] dark:border-[#381932] bg-[#FFF3E6] dark:bg-[#381932] shadow-xs flex flex-col justify-between transition-all', !addon.active && 'opacity-60')}>
            <div>
              <div className="relative aspect-video w-full bg-[#FFF3E6] dark:bg-[#381932] overflow-hidden">
                {addon.image ? (
                  <img src={resolveImageUrl(addon.image)} alt={addon.name} className="h-full w-full object-cover" onError={handleImageError} />
                ) : (
                  <div className="flex h-full items-center justify-center text-xs font-semibold text-[#381932]">No Image</div>
                )}
                <span className={`absolute top-2.5 right-2.5 rounded-full px-2.5 py-0.5 text-[10px] font-extrabold uppercase border ${
                  addon.active ? 'bg-[#FFF3E6] dark:bg-[#381932]/80 text-[#381932] dark:text-[#381932] border-[#381932] dark:border-[#381932]' : 'bg-[#FFF3E6] dark:bg-[#381932] text-[#381932] border-[#381932] dark:border-[#381932]'
                }`}>
                  {addon.active ? 'Active' : 'Hidden'}
                </span>
              </div>
              <div className="p-4 space-y-1.5">
                <h3 className="truncate text-sm font-bold text-[#381932] dark:text-[#FFF3E6]">{addon.name}</h3>
                <div className="text-xs font-black text-[#381932] dark:text-[#381932]">₹{Number(addon.price || 0).toLocaleString('en-IN')}</div>
                <p className="line-clamp-2 text-xs font-medium text-[#381932] dark:text-[#381932]">{addon.description || 'No description provided.'}</p>
              </div>
            </div>

            <div className="p-4 pt-0 flex items-center gap-1.5">
              <button 
                type="button"
                className="flex-1 inline-flex items-center justify-center gap-1 rounded-xl border border-[#381932] dark:border-[#381932] bg-[#FFF3E6] dark:bg-[#381932] px-3 py-2 text-xs font-bold text-[#381932] dark:text-[#381932] hover:bg-[#FFF3E6] dark:hover:bg-[#381932] transition-colors cursor-pointer" 
                onClick={() => openEdit(addon)}
              >
                <Pencil size={12} /> Edit
              </button>
              <button 
                type="button"
                className="inline-flex items-center justify-center rounded-xl border border-[#381932] dark:border-[#381932] bg-[#FFF3E6] dark:bg-[#381932] p-2 text-xs font-bold text-[#381932] dark:text-[#381932] hover:bg-[#FFF3E6] dark:hover:bg-[#381932] transition-colors cursor-pointer" 
                onClick={() => toggle(addon._id, !addon.active)}
              >
                {addon.active ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
              <button 
                type="button"
                className="inline-flex items-center justify-center rounded-xl border border-[#381932] dark:border-[#381932]/50 bg-[#FFF3E6] dark:bg-[#381932]/40 p-2 text-xs font-bold text-[#381932] dark:text-[#381932] hover:bg-[#FFF3E6] dark:hover:bg-[#381932]/60 transition-colors cursor-pointer" 
                onClick={() => setDeleteConfirm({ id: addon._id, name: addon.name })}
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>

      {filtered.length > PAGE_SIZE && (
        <div className="flex items-center justify-between border-t border-[#381932] dark:border-[#381932] pt-4">
          <button 
            type="button"
            className="rounded-xl border border-[#381932] dark:border-[#381932] px-4 py-2 text-xs font-bold text-[#381932] dark:text-[#381932] disabled:opacity-50 cursor-pointer" 
            disabled={safePage === 1} 
            onClick={() => setPage((prev) => Math.max(1, prev - 1))}
          >
            Previous
          </button>
          <span className="text-xs font-bold text-[#381932] dark:text-[#FFF3E6]">Page {safePage} of {pageCount}</span>
          <button 
            type="button"
            className="rounded-xl border border-[#381932] dark:border-[#381932] px-4 py-2 text-xs font-bold text-[#381932] dark:text-[#381932] disabled:opacity-50 cursor-pointer" 
            disabled={safePage === pageCount} 
            onClick={() => setPage((prev) => Math.min(pageCount, prev + 1))}
          >
            Next
          </button>
        </div>
      )}

      {showModal && (
        <Modal title={editing ? 'Edit Add-on' : 'Add Add-on'} onClose={() => setShowModal(false)} large>
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-extrabold uppercase text-[#381932]">Name *</label>
                <input className="mt-1 w-full rounded-xl border border-[#381932] dark:border-[#381932] bg-[#FFF3E6] dark:bg-[#381932] px-3.5 py-2.5 text-xs font-semibold text-[#381932] dark:text-[#FFF3E6] outline-none" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Rose Petal Garland" />
              </div>
              <div>
                <label className="text-xs font-extrabold uppercase text-[#381932]">Price (₹) *</label>
                <input type="number" min="0" className="mt-1 w-full rounded-xl border border-[#381932] dark:border-[#381932] bg-[#FFF3E6] dark:bg-[#381932] px-3.5 py-2.5 text-xs font-semibold text-[#381932] dark:text-[#FFF3E6] outline-none" value={form.price} onChange={(e) => setForm((f) => ({ ...f, price: Number(e.target.value) }))} />
              </div>
            </div>

            <div>
              <label className="text-xs font-extrabold uppercase text-[#381932]">Description / Details</label>
              <textarea className="mt-1 w-full rounded-xl border border-[#381932] dark:border-[#381932] bg-[#FFF3E6] dark:bg-[#381932] px-3.5 py-2.5 text-xs font-medium text-[#381932] dark:text-[#FFF3E6] outline-none" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} rows={3} placeholder="Describe the add-on package" />
            </div>

            <div className="flex gap-2 border-b border-[#381932] dark:border-[#381932] pb-2">
              <button
                type="button"
                className={`rounded-xl px-3 py-1.5 text-xs font-bold transition-all cursor-pointer ${imageMode === 'upload' ? 'bg-[#381932] text-[#FFF3E6]' : 'bg-[#FFF3E6] dark:bg-[#381932] text-[#381932] dark:text-[#381932]'}`}
                onClick={() => setImageMode('upload')}
              >
                <Upload size={13} className="mr-1 inline" /> Upload File
              </button>
              <button
                type="button"
                className={`rounded-xl px-3 py-1.5 text-xs font-bold transition-all cursor-pointer ${imageMode === 'url' ? 'bg-[#381932] text-[#FFF3E6]' : 'bg-[#FFF3E6] dark:bg-[#381932] text-[#381932] dark:text-[#381932]'}`}
                onClick={() => setImageMode('url')}
              >
                <LinkIcon size={13} className="mr-1 inline" /> Image URL
              </button>
            </div>

            {imageMode === 'upload' ? (
              <div
                className="rounded-2xl border-2 border-dashed border-[#381932] dark:border-[#381932] p-6 text-center bg-[#FFF3E6]/50 dark:bg-[#381932]/40"
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleDropUpload}
              >
                <input
                  type="file"
                  id="addon-image-upload"
                  accept="image/*"
                  onChange={handleFileUpload}
                  className="hidden"
                  disabled={uploading}
                />
                <label htmlFor="addon-image-upload" className="cursor-pointer space-y-1 block">
                  {uploading ? (
                    <div className="text-xs font-bold text-[#381932]">Uploading image to cloud...</div>
                  ) : (
                    <>
                      <div className="flex justify-center text-[#381932] mb-2"><Upload size={24} /></div>
                      <div className="text-xs font-bold text-[#381932] dark:text-[#FFF3E6]">{form.image ? 'Change Image' : 'Choose Image File'}</div>
                      <div className="text-[10px] text-[#381932] font-semibold">Drag &amp; drop or click to browse · Max 4MB</div>
                    </>
                  )}
                </label>
              </div>
            ) : (
              <input
                className="w-full rounded-xl border border-[#381932] dark:border-[#381932] bg-[#FFF3E6] dark:bg-[#381932] px-3.5 py-2.5 text-xs font-semibold text-[#381932] dark:text-[#FFF3E6] outline-none"
                value={imageUrlInput}
                onChange={(e) => setImageUrlInput(e.target.value)}
                placeholder="https://example.com/addon.jpg"
              />
            )}

            {previewUrl && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs font-extrabold text-[#381932] uppercase">
                  <span>Image Preview</span>
                  <button
                    type="button"
                    className="text-[#381932] hover:underline cursor-pointer"
                    onClick={() => {
                      setUploadedImage('');
                      setImageUrlInput('');
                      setForm((f) => ({ ...f, image: '' }));
                    }}
                  >
                    Remove
                  </button>
                </div>
                {previewIsValid ? (
                  <img src={resolveImageUrl(previewUrl)} alt="Add-on preview" className="h-44 w-full rounded-xl object-cover border border-[#381932] dark:border-[#381932]" onError={handleImageError} />
                ) : (
                  <div className="flex h-44 items-center justify-center rounded-xl border border-dashed border-[#381932] dark:border-[#381932] text-xs font-semibold text-[#381932]">Image preview unavailable</div>
                )}
              </div>
            )}

            <div className="flex items-center justify-end gap-3 border-t border-[#381932] dark:border-[#381932] pt-4">
              <button type="button" className="rounded-xl border border-[#381932] dark:border-[#381932] px-4 py-2.5 text-xs font-bold text-[#381932] dark:text-[#381932] cursor-pointer" onClick={() => setShowModal(false)}>Cancel</button>
              <button type="button" className="rounded-xl bg-[#381932] text-[#FFF3E6] px-4 py-2.5 text-xs font-bold shadow-md shadow-[#381932]/20 cursor-pointer" onClick={save}>{editing ? 'Save Changes' : 'Add Add-on'}</button>
            </div>
          </div>
        </Modal>
      )}

      {deleteConfirm && (
        <ConfirmModal
          title="Delete Add-on"
          message={`Are you sure you want to delete "${deleteConfirm.name}"?`}
          onConfirm={() => del(deleteConfirm.id)}
          onCancel={() => setDeleteConfirm(null)}
          confirmText="Delete"
        />
      )}
    </div>
  );
};
