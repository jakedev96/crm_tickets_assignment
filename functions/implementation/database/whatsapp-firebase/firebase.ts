import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import path from 'path'

if (process.env.FIRESTORE_EMULATOR_HOST) {
  initializeApp({ projectId: process.env.FB_PROJECT_ID })
} else {
  const serviceAccountPath = process.env.WHATSAPP_SERVICE_ACCOUNT
  if (!serviceAccountPath) throw new Error('Env WHATSAPP_SERVICE_ACCOUNT não definida')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const serviceAccount = require(path.resolve(process.cwd(), serviceAccountPath))
  initializeApp({ credential: cert(serviceAccount) })
}

export const db = getFirestore()
