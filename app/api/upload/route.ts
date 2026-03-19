import { NextRequest, NextResponse } from 'next/server'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import { getCurrentUserId } from '@/lib/auth/get-current-user'
import {
  getR2Client,
  R2_BUCKET_NAME,
  R2_PUBLIC_URL
} from '@/lib/storage/r2-client'

// CONFIGURATION VERCEL POUR GROS FICHIERS
export const maxDuration = 60 // 60 secondes de délai max
export const dynamic = 'force-dynamic'

const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50MB
const ALLOWED_TYPES = [
  'image/jpeg', 
  'image/png', 
  'image/webp',
  'application/pdf', 
  'application/epub+zip'
]

export async function POST(req: NextRequest) {
  try {
    const userId = await getCurrentUserId()
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const formData = await req.formData()
    const file = formData.get('file') as File
    const chatId = formData.get('chatId') as string
    
    if (!file) {
      return NextResponse.json({ error: 'File is required' }, { status: 400 })
    }

    // Vérification de la taille
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `Fichier trop gros (Max 50MB). Taille actuelle: ${(file.size / (1024*1024)).toFixed(2)}MB` },
        { status: 400 }
      )
    }

    // Vérification du type (souple pour EPUB)
    const isEpub = file.name.toLowerCase().endsWith('.epub')
    if (!ALLOWED_TYPES.includes(file.type) && !isEpub) {
      return NextResponse.json(
        { error: 'Format non supporté (PDF, EPUB, Images uniquement)' },
        { status: 400 }
      )
    }

    const result = await uploadFileToR2(file, userId, chatId)
    return NextResponse.json({ success: true, file: result }, { status: 200 })
  } catch (err: any) {
    console.error('Upload Error:', err)
    
    // Message spécifique pour la limite Vercel Hobby
    if (err.message.includes('BODY_SIZE_LIMIT')) {
      return NextResponse.json(
        { error: 'Limite Vercel dépassée (Max 4.5MB sur plan gratuit)' },
        { status: 413 }
      )
    }

    return NextResponse.json(
      { error: 'Upload failed', message: err.message },
      { status: 500 }
    )
  }
}

function sanitizeFilename(filename: string) {
  return filename.replace(/[^a-z0-9.\-_]/gi, '_').toLowerCase()
}

async function uploadFileToR2(file: File, userId: string, chatId: string) {
  const sanitizedFileName = sanitizeFilename(file.name)
  const filePath = `${userId}/chats/${chatId}/${Date.now()}-${sanitizedFileName}`
  const finalType = file.name.toLowerCase().endsWith('.epub') ? 'application/epub+zip' : file.type

  try {
    const buffer = Buffer.from(await file.arrayBuffer())
    const r2Client = getR2Client()

    await r2Client.send(
      new PutObjectCommand({
        Bucket: R2_BUCKET_NAME,
        Key: filePath,
        Body: buffer,
        ContentType: finalType,
      })
    )

    const publicUrl = `${R2_PUBLIC_URL}/${filePath}`

    return {
      filename: file.name,
      url: publicUrl,
      mediaType: finalType,
      type: 'file'
    }
  } catch (error: any) {
    throw new Error('Erreur R2: ' + error.message)
  }
}
