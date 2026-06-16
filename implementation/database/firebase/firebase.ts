import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import path from 'path'

const serviceAccountPath = process.env.WHATSAPP_SERVICE_ACCOUNT
if (!serviceAccountPath) throw new Error('Env WHATSAPP_SERVICE_ACCOUNT não definida')

// eslint-disable-next-line @typescript-eslint/no-require-imports
const serviceAccount = require(path.resolve(process.cwd(), serviceAccountPath))

initializeApp({ credential: cert(serviceAccount) })

export const db = getFirestore()
