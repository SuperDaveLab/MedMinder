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
      title: 'Med-Minder reminder',
      body: event.data.text(),
      tag: 'med-minder-reminder',
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
      icon: '/med-minder-icon.svg',
      badge: '/med-minder-icon.svg',
      data: {
        url: payload.url ?? '/?view=care',
      },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  const targetUrl = String((event.notification.data as { url?: string } | undefined)?.url ?? '/?view=care')

  event.waitUntil((async () => {
    const windowClients = await self.clients.matchAll({
      type: 'window',
      includeUncontrolled: true,
    })

    for (const client of windowClients) {
      const windowClient = client as WindowClient
      if (windowClient.url.includes(self.location.origin)) {
        await windowClient.focus()
        windowClient.navigate(targetUrl)
        return
      }
    }

    await self.clients.openWindow(targetUrl)
  })())
})
