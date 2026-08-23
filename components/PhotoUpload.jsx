'use client';

// Identification photo for one person.
//
// The resize happens IN THE BROWSER, before anything is uploaded. A phone
// camera produces a 4000-pixel, 8MB JPEG; check-in happens on a phone over
// camp wifi. Sending the original and resizing on a server would mean the
// family waits on the upload and the staffer waits on the download. Every
// photo leaves here as a 512x512 square at quality 0.8 — roughly 40-60KB —
// so storage stays predictable and a roster of thumbnails loads at once.
//
// A square centre crop is deliberate rather than letterboxing: these are used
// as small round avatars at check-in, where a letterboxed portrait becomes a
// sliver of forehead.
//
// The bucket is PRIVATE. Reading a photo requires a signed URL minted on the
// server for someone whose row-level security allows it, so a leaked path is
// not a leaked photograph.

import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

const SIZE = 512;
const QUALITY = 0.8;

// Draw the largest centred square of the source image into a SIZE x SIZE
// canvas and re-encode as JPEG. Returns a Blob.
async function squareJpeg(file) {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const sx = (bitmap.width - side) / 2;
  const sy = (bitmap.height - side) / 2;

  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, SIZE, SIZE);
  bitmap.close?.();

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Could not process that image.'))),
      'image/jpeg',
      QUALITY
    );
  });
}

export default function PhotoUpload({ personId, personName, initialUrl = null }) {
  const supabase = createClient();
  const fileRef = useRef(null);
  const [preview, setPreview] = useState(initialUrl);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const objectUrl = useRef(null);

  // A blob: URL is a handle into this tab's memory; without this the preview
  // keeps the old image alive after it has been replaced.
  useEffect(() => {
    return () => {
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    };
  }, []);

  async function onPick(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    setNote('');
    setBusy(true);
    try {
      if (!file.type.startsWith('image/')) {
        throw new Error('Please choose an image file.');
      }
      const blob = await squareJpeg(file);

      // One object per person, overwritten on replacement, so a family that
      // uploads five times does not leave four orphans in the bucket.
      const path = `${personId}/photo.jpg`;
      const { error: upErr } = await supabase.storage
        .from('person-photos')
        .upload(path, blob, { upsert: true, contentType: 'image/jpeg', cacheControl: '3600' });
      if (upErr) throw new Error(upErr.message);

      const { error: rowErr } = await supabase
        .from('person_photos')
        .upsert(
          { person_id: personId, storage_path: path, uploaded_at: new Date().toISOString() },
          { onConflict: 'person_id' }
        );
      if (rowErr) throw new Error(rowErr.message);

      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
      objectUrl.current = URL.createObjectURL(blob);
      setPreview(objectUrl.current);
      setNote(`Saved — ${Math.round(blob.size / 1024)}KB.`);
    } catch (err) {
      setError(err.message || 'Could not upload that photo.');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-4">
      <div className="h-24 w-24 shrink-0 overflow-hidden rounded-full border border-neutral-300 bg-neutral-100">
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt={`${personName || 'Person'}'s photo`} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs text-neutral-400 text-center px-2">
            No photo yet
          </div>
        )}
      </div>
      <div className="min-w-0">
        <label className="btn-outline !py-1.5 text-sm cursor-pointer inline-block">
          {busy ? 'Working…' : preview ? 'Replace photo' : 'Add a photo'}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="user"
            className="sr-only"
            disabled={busy}
            onChange={onPick}
          />
        </label>
        <p className="mt-2 text-xs text-neutral-500 max-w-sm">
          A clear photo of {personName || 'this person'}&rsquo;s face helps staff greet them by
          name at check-in. It is resized on your device before it is sent, so any photo from
          your phone is fine. Camp staff can see it; it is never published, never shown
          on a public page, and never leaves the ministry.
        </p>
        {note && <p className="mt-1 text-xs text-green-700 font-semibold">{note}</p>}
        {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
      </div>
    </div>
  );
}
