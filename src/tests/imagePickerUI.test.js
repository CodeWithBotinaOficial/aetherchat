import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/svelte';
import ImagePickerItem from '$lib/components/imagePicker/ImagePickerItem.svelte';
import ImageAttachmentView from '$lib/components/imagePicker/ImageAttachmentView.svelte';

vi.mock('$lib/services/db/imageAttachments.db.js', () => ({
  getImageAttachment: vi.fn(async (id) => {
    if (id === 't1') return { blob: new Blob(['test'], { type: 'image/jpeg' }), size: 4 };
    return null;
  })
}));

describe('ImagePicker UI Components', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('ImagePickerItem renders and fires toggle event', async () => {
    const { getByRole, component } = render(ImagePickerItem, { 
      props: { blob: new Blob([]), selected: false, disabled: false } 
    });
    
    const btn = getByRole('button');
    expect(btn).toBeDefined();

    const mockFn = vi.fn();
    component.$on('toggle', mockFn);
    
    await fireEvent.click(btn);
    expect(mockFn).toHaveBeenCalled();
  });

  it('ImageAttachmentView loads and renders images', async () => {
    // Stub URL.createObjectURL since it's not present in JSDOM
    global.URL.createObjectURL = vi.fn(() => 'blob:test-url');
    global.URL.revokeObjectURL = vi.fn();

    const { container, component } = render(ImageAttachmentView, { 
      props: { transferIds: ['t1'] } 
    });
    
    await waitFor(() => {
      const img = container.querySelector('img');
      expect(img).toBeDefined();
      expect(img.src).toContain('blob:test-url');
    });

    const mockFn = vi.fn();
    component.$on('openLightbox', mockFn);

    const btn = container.querySelector('button');
    await fireEvent.click(btn);
    
    expect(mockFn).toHaveBeenCalled();
    expect(mockFn.mock.calls[0][0].detail.index).toBe(0);
    expect(mockFn.mock.calls[0][0].detail.images[0].id).toBe('t1');
  });
});
