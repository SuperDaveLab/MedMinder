import { initializeAuthSchema } from './db'

async function main(): Promise<void> {
  await initializeAuthSchema()
  console.log('Auth schema initialized successfully.')
  process.exit(0)
}

main().catch((error) => {
  console.error('Failed to initialize auth schema.', error)
  process.exit(1)
})
