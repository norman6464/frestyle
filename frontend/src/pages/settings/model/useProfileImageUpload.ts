import { useState, useCallback } from 'react';
import { ProfileRepository } from '@/entities/user';
import { logger } from '@/shared/lib/logger';

const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

export function useProfileImageUpload() {
  const [uploading, setUploading] = useState(false);

  const upload = useCallback(async (file: File): Promise<string | null> => {
    if (!ALLOWED_TYPES.includes(file.type)) {
      return null;
    }

    setUploading(true);
    const send = async () => {
      const { uploadUrl, imageUrl } = await ProfileRepository.getImagePresignedUrl(file.type, file.size);
      await ProfileRepository.uploadToS3(uploadUrl, file);
      return imageUrl;
    };
    const imageUrl = await send().catch((error: unknown) => {
      logger.error('プロフィール画像のアップロードに失敗しました:', error);
      return null;
    });
    setUploading(false);
    return imageUrl;
  }, []);

  return { upload, uploading };
}
