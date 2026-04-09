/// <reference lib="WebWorker" />

import { precacheAndRoute } from 'workbox-precaching'

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>
}

interface PushMessagePayload {
  title: string
  body: string
  tag: string
  url?: string
  patientId?: string
  requireInteraction?: boolean
}

precacheAndRoute(self.__WB_MANIFEST)

self.addEventListener('push', (event) => {
  if (!event.data) {
    return
  }

  let payload: PushMessagePayload | null = null

  try {
    payload = event.data.json() as PushMessagePayload
  } catch {
    payload = {
      title: 'Nexpill reminder',
      body: event.data.text(),
      tag: 'nexpill-reminder',
    }
  }

  if (!payload || !payload.title || !payload.body) {
    return
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      tag: payload.tag,
      requireInteraction: payload.requireInteraction ?? false,
      icon: '/nexpill-icon.svg',
      badge: '/nexpill-icon.svg',
      data: {
        url: payload.url ?? '/?view=care',
        patientId: payload.patientId,
      },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  const notificationData = event.notification.data as { url?: string; patientId?: string } | undefined
  const targetUrl = String(notificationData?.url ?? '/?view=care')
  const targetPatientId = notificationData?.patientId

  event.waitUntil((async () => {
    const windowClients = await self.clients.matchAll({
      type: 'window',
      includeUncontrolled: true,
    })

    for (const client of windowClients) {
      const windowClient = client as WindowClient
      if (windowClient.url.includes(self.location.origin)) {
        await windowClient.focus()
        if (targetPatientId) {
          windowClient.postMessage({
            type: 'nexpill-select-patient',
            patientId: targetPatientId,
          })
        }
        await windowClient.navigate(targetUrl)
        return
      }
    }

    await self.clients.openWindow(targetUrl)
  })())
})
