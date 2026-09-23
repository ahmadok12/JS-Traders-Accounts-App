/**
 * JS Traders ERP - High-Efficiency Mobile Image Compressor
 * Compresses phone camera photos on-device using HTML5 Canvas before storage/upload.
 * Achieves ~95% size reduction (e.g. 5MB camera photo -> 60KB-90KB) to prevent storage quota exhaustion.
 */

export class ImageCompressor {
  /**
   * Compresses an image file from <input type="file"> or camera capture
   * @param {File} file - Raw image file
   * @param {Object} options - Compression configuration
   * @returns {Promise<{ dataUrl: string, sizeKb: number, originalSizeKb: number, width: number, height: number }>}
   */
  static async compress(file, {
    maxWidth = 1024,
    maxHeight = 1024,
    quality = 0.7,
    mimeType = 'image/jpeg'
  } = {}) {
    if (!file || !file.type.startsWith('image/')) {
      throw new Error('Provided file is not a valid image.');
    }

    const originalSizeKb = Math.round(file.size / 1024);

    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Failed to read image file.'));
      reader.onload = (e) => {
        const img = new Image();
        img.onerror = () => reject(new Error('Failed to load image into memory.'));
        img.onload = () => {
          try {
            // Calculate proportional dimensions
            let { width, height } = img;
            if (width > maxWidth || height > maxHeight) {
              const ratio = Math.min(maxWidth / width, maxHeight / height);
              width = Math.round(width * ratio);
              height = Math.round(height * ratio);
            }

            // Draw to offscreen canvas
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            
            // Apply smoothing for high-quality downsampling
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(img, 0, 0, width, height);

            // Compress to JPEG
            const dataUrl = canvas.toDataURL(mimeType, quality);
            
            // Calculate compressed size in KB from base64 string
            const stringLength = dataUrl.length - 'data:image/jpeg;base64,'.length;
            const sizeInBytes = 4 * Math.ceil(stringLength / 3) * 0.5624896334383437;
            const sizeKb = Math.round(sizeInBytes / 1024);

            resolve({
              dataUrl,
              sizeKb,
              originalSizeKb,
              width,
              height,
              filename: file.name || `photo-${Date.now()}.jpg`,
              timestamp: new Date().toISOString()
            });
          } catch (err) {
            reject(err);
          }
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    });
  }

  /**
   * Batch compress multiple files
   */
  static async compressMultiple(fileList, options = {}) {
    const files = Array.from(fileList);
    const results = [];
    for (const file of files) {
      if (file.type.startsWith('image/')) {
        const result = await this.compress(file, options);
        results.push(result);
      }
    }
    return results;
  }
}
