import { useCallback, useEffect, useRef, useState } from 'react'
import type { AuthSessionState } from '../domain/auth'
import type { MedMinderState } from '../domain/types'
import {
  buildReminderNotificationCandidates,
  filterUnsentReminderCandidates,
  getReminderPermissionState,
} from '../reminders/notifications'
import { buildInAppAlarmCandidates, type AlarmCandidate } from '../reminders/alarms'
import { syncPushSubscription } from '../reminders/pushRelay'
import {
  getReminderNotificationLog,
  saveReminderNotificationLog,
} from '../storage/repository'

export type AppView = 'care' | 'history' | 'meds' | 'patients' | 'more'

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

  if (view === 'care' || view === 'history' || view === 'meds' || view === 'patients' || view === 'more') {
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
  authState: AuthSessionState | null
}

const ALARM_REPEAT_MS = 20_000
const ALARM_SNOOZE_MINUTES = 5

export function useAppShell({ appState, now, authState }: UseAppShellParams) {
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
  const [activeAlarm, setActiveAlarm] = useState<AlarmCandidate | null>(null)

  const reminderRunInFlightRef = useRef(false)
  const sentReminderKeysRef = useRef<Set<string>>(new Set())
  const acknowledgedAlarmKeysRef = useRef<Set<string>>(new Set())
  const snoozedAlarmKeysRef = useRef<Map<string, number>>(new Map())
  const audioContextRef = useRef<AudioContext | null>(null)
  const wakeLockRef = useRef<WakeLockSentinelLike | null>(null)
  const wakeLockSupported = Boolean((navigator as Navigator & NavigatorWithWakeLock).wakeLock)

  const focusCareView = useCallback(() => {
    if (typeof window.focus === 'function') {
      window.focus()
    }

    setActiveView('care')
    updateUrlForView('care')
  }, [])

  const playAlarmPulse = useCallback(async () => {
    if (typeof window === 'undefined' || typeof window.AudioContext === 'undefined') {
      return
    }

    const context = audioContextRef.current ?? new window.AudioContext()
    audioContextRef.current = context

    if (context.state === 'suspended') {
      await context.resume()
    }

    const oscillator = context.createOscillator()
    const gainNode = context.createGain()

    oscillator.type = 'sine'
    oscillator.frequency.value = 880
    gainNode.gain.value = 0.001

    oscillator.connect(gainNode)
    gainNode.connect(context.destination)

    const startAt = context.currentTime
    gainNode.gain.exponentialRampToValueAtTime(0.12, startAt + 0.02)
    gainNode.gain.exponentialRampToValueAtTime(0.001, startAt + 0.35)

    oscillator.start(startAt)
    oscillator.stop(startAt + 0.38)
  }, [])

  const triggerAlarmPulse = useCallback(() => {
    void playAlarmPulse().catch(() => {
      // ignore audio failures when browser blocks autoplay
    })

    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate([300, 160, 300])
    }
  }, [playAlarmPulse])

  const triggerAlarmPreview = () => {
    triggerAlarmPulse()
  }

  useEffect(() => {
    const nav = window.navigator as Navigator & { standalone?: boolean }
    const refreshInstallState = () => {
      setIsInstalled(isStandaloneDisplayMode() || nav.standalone === true)
    }

    const standaloneMediaQuery =
      typeof window.matchMedia === 'function'
        ? window.matchMedia('(display-mode: standalone)')
        : null

    refreshInstallState()
    standaloneMediaQuery?.addEventListener('change', refreshInstallState)
    window.addEventListener('pageshow', refreshInstallState)
    window.addEventListener('focus', refreshInstallState)

    return () => {
      standaloneMediaQuery?.removeEventListener('change', refreshInstallState)
      window.removeEventListener('pageshow', refreshInstallState)
      window.removeEventListener('focus', refreshInstallState)
    }
  }, [])

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
      const disabledPatientIds = new Set(
        currentState.patients
          .filter((patient) => patient.notificationsEnabled === false)
          .map((patient) => patient.id),
      )
      const candidates = buildReminderNotificationCandidates(
        currentState.medications,
        currentState.doseEvents,
        currentNow,
        disabledPatientIds,
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
        const notification = new Notification(candidate.title, {
          body: candidate.body,
          tag: candidate.dedupeKey,
          badge: 'med-minder-icon.svg',
          icon: 'med-minder-icon.svg',
          requireInteraction: candidate.kind !== 'due-soon',
        })

        notification.onclick = () => {
          focusCareView()
          notification.close()
        }

        updatedReminderLog[candidate.dedupeKey] = currentNow.toISOString()
        sentReminderKeysRef.current.add(candidate.dedupeKey)
      }

      await saveReminderNotificationLog(updatedReminderLog)
    } finally {
      reminderRunInFlightRef.current = false
    }
  }, [focusCareView, notificationPermission])

  useEffect(() => {
    if (!appState) {
      return
    }

    void checkAndSendReminders(appState, now)
  }, [appState, now, checkAndSendReminders])

  useEffect(() => {
    if (notificationPermission !== 'granted') {
      return
    }

    void syncPushSubscription(authState, notificationPermission).catch((error) => {
      console.error('[push] Failed to sync subscription:', error)
    })
  }, [authState, notificationPermission])

  useEffect(() => {
    if (!appState) {
      setActiveAlarm(null)
      return
    }

    const nowTimestamp = now.getTime()
    const candidates = buildInAppAlarmCandidates(
      appState.medications,
      appState.doseEvents,
      now,
    )

    for (const [key, snoozedUntil] of snoozedAlarmKeysRef.current.entries()) {
      if (snoozedUntil <= nowTimestamp) {
        snoozedAlarmKeysRef.current.delete(key)
      }
    }

    const nextAlarm = candidates.find((candidate) => {
      if (acknowledgedAlarmKeysRef.current.has(candidate.dedupeKey)) {
        return false
      }

      const snoozedUntil = snoozedAlarmKeysRef.current.get(candidate.dedupeKey)
      return !snoozedUntil || snoozedUntil <= nowTimestamp
    }) ?? null

    setActiveAlarm((previousAlarm) => {
      if (!nextAlarm) {
        return null
      }

      if (previousAlarm?.dedupeKey === nextAlarm.dedupeKey) {
        return previousAlarm
      }

      return nextAlarm
    })
  }, [appState, now])

  useEffect(() => {
    if (!activeAlarm) {
      return
    }

    triggerAlarmPulse()

    const timer = window.setInterval(() => {
      triggerAlarmPulse()
    }, ALARM_REPEAT_MS)

    return () => {
      window.clearInterval(timer)
    }
  }, [activeAlarm, triggerAlarmPulse])

  useEffect(() => {
    if (!activeAlarm) {
      return
    }

    const replayAlarmPulse = () => {
      if (document.visibilityState !== 'hidden') {
        triggerAlarmPulse()
      }
    }

    window.addEventListener('focus', replayAlarmPulse)
    window.addEventListener('pageshow', replayAlarmPulse)
    document.addEventListener('visibilitychange', replayAlarmPulse)

    return () => {
      window.removeEventListener('focus', replayAlarmPulse)
      window.removeEventListener('pageshow', replayAlarmPulse)
      document.removeEventListener('visibilitychange', replayAlarmPulse)
    }
  }, [activeAlarm, triggerAlarmPulse])

  const acknowledgeActiveAlarm = () => {
    if (!activeAlarm) {
      return
    }

    acknowledgedAlarmKeysRef.current.add(activeAlarm.dedupeKey)
    snoozedAlarmKeysRef.current.delete(activeAlarm.dedupeKey)
    setActiveAlarm(null)
  }

  const snoozeActiveAlarm = () => {
    if (!activeAlarm) {
      return
    }

    snoozedAlarmKeysRef.current.set(
      activeAlarm.dedupeKey,
      now.getTime() + ALARM_SNOOZE_MINUTES * 60_000,
    )
    setActiveAlarm(null)
  }

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
    activeAlarm,
    acknowledgeActiveAlarm,
    snoozeActiveAlarm,
    triggerAlarmPreview,
  }
}
