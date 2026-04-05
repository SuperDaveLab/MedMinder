import { useCallback, useEffect, useRef, useState } from 'react'
import type { MedMinderState } from '../domain/types'
import {
  buildReminderNotificationCandidates,
  filterUnsentReminderCandidates,
  getReminderPermissionState,
} from '../reminders/notifications'
import {
  getReminderNotificationLog,
  saveReminderNotificationLog,
} from '../storage/repository'

export type AppView = 'care' | 'history' | 'meds' | 'more'

interface DeferredInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

interface WakeLockSentinelLike {
  release: () => Promise<void>
  addEventListener: (type: 'release', listener: () => void) => void
}

interface NavigatorWithWakeLock {
  wakeLock?: {
    request: (type: 'screen') => Promise<WakeLockSentinelLike>
  }
}

function getInitialViewFromUrl(): AppView {
  const url = new URL(window.location.href)
  const view = url.searchParams.get('view')

  if (view === 'care' || view === 'history' || view === 'meds' || view === 'more') {
    return view as AppView
  }
  if (view === 'admin') return 'meds'
  if (view === 'summary') return 'more'

  return 'care'
}

function updateUrlForView(view: AppView): void {
  const url = new URL(window.location.href)
  url.searchParams.set('view', view)
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
}

function isStandaloneDisplayMode(): boolean {
  if (typeof window.matchMedia !== 'function') {
    return false
  }

  return window.matchMedia('(display-mode: standalone)').matches
}

interface UseAppShellParams {
  appState: MedMinderState | null
  now: Date
}

export function useAppShell({ appState, now }: UseAppShellParams) {
  const [notificationPermission, setNotificationPermission] = useState(getReminderPermissionState())
  const [activeView, setActiveView] = useState<AppView>(getInitialViewFromUrl())
  const [installPromptEvent, setInstallPromptEvent] = useState<DeferredInstallPromptEvent | null>(null)
  const [isInstalled, setIsInstalled] = useState(() => {
    const nav = window.navigator as Navigator & { standalone?: boolean }
    return isStandaloneDisplayMode() || nav.standalone === true
  })
  const [, setInstallHint] = useState<string | null>(null)
  const [isWakeLockActive, setIsWakeLockActive] = useState(false)
  const [, setWakeLockMessage] = useState<string | null>(null)

  const reminderRunInFlightRef = useRef(false)
  const sentReminderKeysRef = useRef<Set<string>>(new Set())
  const wakeLockRef = useRef<WakeLockSentinelLike | null>(null)
  const wakeLockSupported = Boolean((navigator as Navigator & NavigatorWithWakeLock).wakeLock)

  useEffect(() => {
    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault()
      setInstallPromptEvent(event as DeferredInstallPromptEvent)
      setInstallHint('Install available on this device.')
    }

    const onAppInstalled = () => {
      setIsInstalled(true)
      setInstallPromptEvent(null)
      setInstallHint('App installed.')
    }

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)
    window.addEventListener('appinstalled', onAppInstalled)

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
      window.removeEventListener('appinstalled', onAppInstalled)
    }
  }, [])

  const handleInstallApp = async () => {
    if (isInstalled) {
      setInstallHint('Already installed.')
      return
    }

    if (!installPromptEvent) {
      setInstallHint('Install prompt unavailable. Use your browser menu to Add to Home Screen.')
      return
    }

    await installPromptEvent.prompt()
    const choice = await installPromptEvent.userChoice

    if (choice.outcome === 'accepted') {
      setInstallHint('Install accepted.')
      setInstallPromptEvent(null)
      setIsInstalled(true)
    } else {
      setInstallHint('Install dismissed.')
    }
  }

  const handleToggleWakeLock = async () => {
    const nav = navigator as Navigator & NavigatorWithWakeLock

    if (!nav.wakeLock) {
      setWakeLockMessage('Wake lock is not supported on this browser/device.')
      return
    }

    if (isWakeLockActive && wakeLockRef.current) {
      await wakeLockRef.current.release()
      wakeLockRef.current = null
      setIsWakeLockActive(false)
      setWakeLockMessage('Screen wake lock off.')
      return
    }

    try {
      const sentinel = await nav.wakeLock.request('screen')
      wakeLockRef.current = sentinel
      sentinel.addEventListener('release', () => {
        wakeLockRef.current = null
        setIsWakeLockActive(false)
      })
      setIsWakeLockActive(true)
      setWakeLockMessage('Screen wake lock on.')
    } catch {
      setWakeLockMessage('Unable to enable wake lock right now.')
    }
  }

  const requestNotificationPermission = async () => {
    if (typeof Notification === 'undefined' || notificationPermission !== 'default') {
      return
    }

    const permission = await Notification.requestPermission()
    setNotificationPermission(permission)
  }

  const checkAndSendReminders = useCallback(async (
    currentState: MedMinderState,
    currentNow: Date,
  ) => {
    if (notificationPermission !== 'granted' || typeof Notification === 'undefined') {
      return
    }

    if (reminderRunInFlightRef.current) {
      return
    }

    reminderRunInFlightRef.current = true

    try {
      const candidates = buildReminderNotificationCandidates(
        currentState.medications,
        currentState.doseEvents,
        currentNow,
      )

      if (candidates.length === 0) {
        return
      }

      const reminderLog = await getReminderNotificationLog()
      const unsentCandidates = filterUnsentReminderCandidates(candidates, reminderLog)
        .filter((candidate) => !sentReminderKeysRef.current.has(candidate.dedupeKey))

      if (unsentCandidates.length === 0) {
        return
      }

      const updatedReminderLog = { ...reminderLog }

      for (const candidate of unsentCandidates) {
        new Notification(candidate.title, {
          body: candidate.body,
          tag: candidate.dedupeKey,
        })
        updatedReminderLog[candidate.dedupeKey] = currentNow.toISOString()
        sentReminderKeysRef.current.add(candidate.dedupeKey)
      }

      await saveReminderNotificationLog(updatedReminderLog)
    } finally {
      reminderRunInFlightRef.current = false
    }
  }, [notificationPermission])

  useEffect(() => {
    if (!appState) {
      return
    }

    void checkAndSendReminders(appState, now)
  }, [appState, now, checkAndSendReminders])

  const setView = (view: AppView) => {
    setActiveView(view)
    updateUrlForView(view)
  }

  return {
    activeView,
    setView,
    notificationPermission,
    requestNotificationPermission,
    installPromptAvailable: Boolean(installPromptEvent),
    isInstalled,
    handleInstallApp,
    wakeLockSupported,
    isWakeLockActive,
    handleToggleWakeLock,
  }
}
