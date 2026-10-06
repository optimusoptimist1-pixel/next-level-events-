import { useEffect, useMemo, useState } from 'react';
import { toast } from 'react-toastify';
import { Eye, EyeOff, Pencil, Search, Trash2, Upload, Link as LinkIcon, ArrowUp, ArrowDown } from 'lucide-react';
import { Modal } from './Modal';
import { ConfirmModal } from './ConfirmModal';
import { cn } from '../../lib/utils';
import { getApiUrl, authFetch, parseJsonSafe } from '../../lib/api';
import { UPLOAD_URL } from '../../lib/uploads';
import { compressImage } from '../../lib/imageCompress';
import { resolveImageUrl, handleImageError } from '../../lib/imageUrl';
import type { AdminGalleryImage } from '../../types';
import { broadcastCrmUpdate } from '../../lib/syncChannel';

const getGalleryApi = () => getApiUrl('/api/gallery');
const PAGE_SIZE = 12;
const GALLERY_LIMIT = 50;

export const GalleryView = () => {
  const [images, setImages] = useState<AdminGalleryImage[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [page, setPage] = useState(1);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<AdminGalleryImage | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; title: string } | null>(null);
  const [imageMode, setImageMode] = useState<'upload' | 'url'>('upload');
  const [uploading, setUploading] = useState(false);
  const [uploadedImage, setUploadedImage] = useState('');
  const [imageUrlInput, setImageUrlInput] = useState('');
  const [form, setForm] = useState({
    title: '',
    category: '',
    active: true,
  });

  const fetchImages = async () => {
    try {
      const res = await authFetch(getGalleryApi());
      const parsed = await parseJsonSafe<AdminGalleryImage[]>(res);
      if (parsed.ok && Array.isArray(parsed.data)) {
        setImages(parsed.data);
        return;
      }
      throw new Error('Failed to load gallery images');
    } catch {
      toast.error('Failed to load gallery images');
    }
  };

  useEffect(() => {
    void fetchImages();
  }, []);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return images.filter((img) => {
      const matchesSearch = !query || [img.title || '', img.category || '']
        .join(' ')
        .toLowerCase()
        .includes(query);

      const matchesStatus = statusFilter === 'all'
        ? true
        : statusFilter === 'active'
          ? img.active
          : !img.active;

      return matchesSearch && matchesStatus;
    });
  }, [images, search, statusFilter]);

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
    // Site-relative paths ("/cabana.webp") are valid -- the migrated gallery
    // assets use them, and resolveImageUrl() already handles them.
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
    formData.append('folder', 'ems/gallery');

    try {
      const response = await authFetch(UPLOAD_URL, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) throw new Error('Upload failed');

      const data = await response.json();
      setUploadedImage(data.secure_url);
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
    setForm({ title: '', category: '', active: true });
    setShowModal(true);
  };

  const openEdit = (img: AdminGalleryImage) => {
    setEditing(img);
    resetImageState();
    setForm({
      title: img.title || '',
      category: img.category || '',
      active: img.active,
    });
    setUploadedImage(img.imageUrl || '');
    setImageUrlInput(img.imageUrl || '');
    setShowModal(true);
  };

  const save = async () => {
    const finalImage = (uploadedImage || imageUrlInput.trim()).trim();
    if (!finalImage) {
      toast.error('Gallery image is required');
      return;
    }

    if (imageUrlInput.trim() && !isValidImageUrl(imageUrlInput.trim())) {
      toast.error('Please enter a valid image URL');
      return;
    }

    try {
      const payload = {
        imageUrl: finalImage,
        title: form.title.trim(),
        category: form.category.trim(),
        active: form.active,
      };

      if (editing) {
        const res = await authFetch(`${getGalleryApi()}/${editing._id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const updated = await res.json();
        if (!res.ok) throw new Error(updated?.error || 'Failed to update gallery image');
        setImages((prev) => prev.map((item) => item._id === updated._id ? updated : item));
        broadcastCrmUpdate('gallery', updated._id);
        toast.success('Gallery image updated');
      } else {
        const res = await authFetch(getGalleryApi(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const created = await res.json();
        if (!res.ok) throw new Error(created?.error || 'Failed to add gallery image');
        setImages((prev) => [created, ...prev]);
        broadcastCrmUpdate('gallery', created._id);
        toast.success('Gallery image added');
      }

      setShowModal(false);
      void fetchImages();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save gallery image');
    }
  };

  const del = async (id: string) => {
    try {
      await authFetch(`${getGalleryApi()}/${id}`, { method: 'DELETE' });
      setImages((prev) => prev.filter((item) => item._id !== id));
      setDeleteConfirm(null);
      broadcastCrmUpdate('gallery', id);
      toast.success('Gallery image removed');
    } catch {
      toast.error('Failed to remove gallery image');
    }
  };

  // Reordering only operates on the canonical (unfiltered) order -- while a
  // search/status filter is active, positions in the visible grid don't map
  // 1:1 onto the real underlying sequence, so we hide the move buttons then.
  const canReorder = !search.trim() && statusFilter === 'all';

  const moveImage = async (id: string, direction: 'up' | 'down') => {
    const idx = images.findIndex((i) => i._id === id);
    if (idx === -1) return;
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= images.length) return;

    const reordered = [...images];
    [reordered[idx], reordered[swapIdx]] = [reordered[swapIdx], reordered[idx]];
    setImages(reordered);

    try {
      await authFetch(`${getGalleryApi()}/reorder`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderedIds: reordered.map((i) => i._id) }),
      });
      broadcastCrmUpdate('gallery');
    } catch {
      toast.error('Failed to save new order');
      void fetchImages();
    }
  };

  const toggle = async (id: string, active: boolean) => {
    try {
      await authFetch(`${getGalleryApi()}/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active }),
      });
      setImages((prev) => prev.map((item) => item._id === id ? { ...item, active } : item));
      broadcastCrmUpdate('gallery', id);
    } catch {
      toast.error('Failed to update gallery image status');
    }
  };

  const previewUrl = uploadedImage || imageUrlInput.trim();
  const previewIsValid = previewUrl ? isValidImageUrl(previewUrl) : false;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-2xl border border-[#381932] dark:border-[#381932] bg-[#FFF3E6] dark:bg-[#381932] p-5 shadow-xs">
        <div>
          <h2 className="text-xl font-black text-[#381932] dark:text-[#FFF3E6]">Gallery</h2>
          <p className="text-xs font-semibold text-[#381932] dark:text-[#381932] mt-0.5">Add or remove photos shown on the public Gallery page.</p>
        </div>
        <button
          type="button"
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#381932] hover:opacity-90 text-[#FFF3E6] px-4 py-2.5 text-xs font-bold shadow-md shadow-[#381932]/20 active:scale-95 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={openAdd}
          disabled={images.length >= GALLERY_LIMIT}
          title={images.length >= GALLERY_LIMIT ? `Gallery is full (${GALLERY_LIMIT} max) -- remove one first` : undefined}
        >
          + Add Image
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
              placeholder="Search title or category..."
            />
          </div>
          <select
            className="w-full sm:w-40 rounded-xl border border-[#381932] dark:border-[#381932] bg-[#FFF3E6] dark:bg-[#381932] px-3 py-2.5 text-xs font-bold text-[#381932] dark:text-[#FFF3E6] outline-none"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'all' | 'active' | 'inactive')}
          >
            <option value="all">All Statuses</option>
            <option value="active">Active Only</option>
            <option value="inactive">Hidden Only</option>
          </select>
        </div>

        <div className="text-xs font-bold text-[#381932] dark:text-[#381932] self-end sm:self-center">
          {filtered.length} shown &middot; {images.length}/{GALLERY_LIMIT} total images
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
        {paged.map((img) => (
          <div key={img._id} className={cn('overflow-hidden rounded-2xl border border-[#381932] dark:border-[#381932] bg-[#FFF3E6] dark:bg-[#381932] shadow-xs flex flex-col justify-between transition-all', !img.active && 'opacity-60')}>
            <div>
              <div className="relative aspect-square w-full bg-[#FFF3E6] dark:bg-[#381932] overflow-hidden">
                <img src={resolveImageUrl(img.imageUrl)} alt={img.title || 'Gallery'} className="h-full w-full object-cover" onError={handleImageError} />
                <span className={`absolute top-2 right-2 rounded-full px-2 py-0.5 text-[9px] font-extrabold uppercase border ${
                  img.active ? 'bg-[#FFF3E6] dark:bg-[#381932]/80 text-[#381932] dark:text-[#381932] border-[#381932] dark:border-[#381932]' : 'bg-[#FFF3E6] dark:bg-[#381932] text-[#381932] border-[#381932] dark:border-[#381932]'
                }`}>
                  {img.active ? 'Active' : 'Hidden'}
                </span>
              </div>
              <div className="p-3 space-y-1">
                <h3 className="truncate text-xs font-bold text-[#381932] dark:text-[#FFF3E6]">{img.title || 'Untitled'}</h3>
                {img.category && <p className="truncate text-[10px] font-semibold text-[#381932]">{img.category}</p>}
              </div>
            </div>

            <div className="p-3 pt-0 flex items-center gap-1.5">
              {canReorder && (
                <div className="flex flex-col gap-0.5">
                  <button
                    type="button"
                    className="inline-flex items-center justify-center rounded-lg border border-[#381932] dark:border-[#381932] bg-[#FFF3E6] dark:bg-[#381932] p-1 text-[#381932] dark:text-[#381932] disabled:opacity-30 hover:bg-[#FFF3E6] dark:hover:bg-[#381932] transition-colors cursor-pointer disabled:cursor-not-allowed"
                    onClick={() => moveImage(img._id, 'up')}
                    disabled={images.findIndex((i) => i._id === img._id) === 0}
                    title="Move earlier"
                  >
                    <ArrowUp size={11} />
                  </button>
                  <button
                    type="button"
                    className="inline-flex items-center justify-center rounded-lg border border-[#381932] dark:border-[#381932] bg-[#FFF3E6] dark:bg-[#381932] p-1 text-[#381932] dark:text-[#381932] disabled:opacity-30 hover:bg-[#FFF3E6] dark:hover:bg-[#381932] transition-colors cursor-pointer disabled:cursor-not-allowed"
                    onClick={() => moveImage(img._id, 'down')}
                    disabled={images.findIndex((i) => i._id === img._id) === images.length - 1}
                    title="Move later"
                  >
                    <ArrowDown size={11} />
                  </button>
                </div>
              )}
              <button
                type="button"
                className="flex-1 inline-flex items-center justify-center gap-1 rounded-xl border border-[#381932] dark:border-[#381932] bg-[#FFF3E6] dark:bg-[#381932] px-2 py-1.5 text-[11px] font-bold text-[#381932] dark:text-[#381932] hover:bg-[#FFF3E6] dark:hover:bg-[#381932] transition-colors cursor-pointer"
                onClick={() => openEdit(img)}
              >
                <Pencil size={11} /> Edit
              </button>
              <button
                type="button"
                className="inline-flex items-center justify-center rounded-xl border border-[#381932] dark:border-[#381932] bg-[#FFF3E6] dark:bg-[#381932] p-1.5 text-xs font-bold text-[#381932] dark:text-[#381932] hover:bg-[#FFF3E6] dark:hover:bg-[#381932] transition-colors cursor-pointer"
                onClick={() => toggle(img._id, !img.active)}
              >
                {img.active ? <EyeOff size={13} /> : <Eye size={13} />}
              </button>
              <button
                type="button"
                className="inline-flex items-center justify-center rounded-xl border border-[#381932] dark:border-[#381932]/50 bg-[#FFF3E6] dark:bg-[#381932]/40 p-1.5 text-xs font-bold text-[#381932] dark:text-[#381932] hover:bg-[#FFF3E6] dark:hover:bg-[#381932]/60 transition-colors cursor-pointer"
                onClick={() => setDeleteConfirm({ id: img._id, title: img.title || 'this image' })}
              >
                <Trash2 size={13} />
              </button>
            </div>
          </div>
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="rounded-xl border border-dashed border-[#381932] dark:border-[#381932] p-12 text-center text-xs font-bold text-[#381932]">No gallery images yet.</div>
      )}

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
        <Modal title={editing ? 'Edit Gallery Image' : 'Add Gallery Image'} onClose={() => setShowModal(false)} large>
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-extrabold uppercase text-[#381932]">Title</label>
                <input className="mt-1 w-full rounded-xl border border-[#381932] dark:border-[#381932] bg-[#FFF3E6] dark:bg-[#381932] px-3.5 py-2.5 text-xs font-semibold text-[#381932] dark:text-[#FFF3E6] outline-none" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="e.g. Terrace Proposal Setup" />
              </div>
              <div>
                <label className="text-xs font-extrabold uppercase text-[#381932]">Category</label>
                <input className="mt-1 w-full rounded-xl border border-[#381932] dark:border-[#381932] bg-[#FFF3E6] dark:bg-[#381932] px-3.5 py-2.5 text-xs font-semibold text-[#381932] dark:text-[#FFF3E6] outline-none" value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} placeholder="e.g. Birthdays" />
              </div>
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
                  id="gallery-image-upload"
                  accept="image/*"
                  onChange={handleFileUpload}
                  className="hidden"
                  disabled={uploading}
                />
                <label htmlFor="gallery-image-upload" className="cursor-pointer space-y-1 block">
                  {uploading ? (
                    <div className="text-xs font-bold text-[#381932]">Uploading image to cloud...</div>
                  ) : (
                    <>
                      <div className="flex justify-center text-[#381932] mb-2"><Upload size={24} /></div>
                      <div className="text-xs font-bold text-[#381932] dark:text-[#FFF3E6]">{uploadedImage ? 'Change Image' : 'Choose Image File'}</div>
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
                placeholder="https://example.com/photo.jpg"
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
                    }}
                  >
                    Remove
                  </button>
                </div>
                {previewIsValid ? (
                  <img src={resolveImageUrl(previewUrl)} alt="Gallery preview" className="h-44 w-full rounded-xl object-cover border border-[#381932] dark:border-[#381932]" onError={handleImageError} />
                ) : (
                  <div className="flex h-44 items-center justify-center rounded-xl border border-dashed border-[#381932] dark:border-[#381932] text-xs font-semibold text-[#381932]">Image preview unavailable</div>
                )}
              </div>
            )}

            <div className="flex items-center justify-end gap-3 border-t border-[#381932] dark:border-[#381932] pt-4">
              <button type="button" className="rounded-xl border border-[#381932] dark:border-[#381932] px-4 py-2.5 text-xs font-bold text-[#381932] dark:text-[#381932] cursor-pointer" onClick={() => setShowModal(false)}>Cancel</button>
              <button type="button" className="rounded-xl bg-[#381932] text-[#FFF3E6] px-4 py-2.5 text-xs font-bold shadow-md shadow-[#381932]/20 cursor-pointer" onClick={save}>{editing ? 'Save Changes' : 'Add Image'}</button>
            </div>
          </div>
        </Modal>
      )}

      {deleteConfirm && (
        <ConfirmModal
          title="Remove Gallery Image"
          message={`Are you sure you want to remove "${deleteConfirm.title}" from the gallery?`}
          onConfirm={() => del(deleteConfirm.id)}
          onCancel={() => setDeleteConfirm(null)}
          confirmText="Remove"
        />
      )}
    </div>
  );
};
