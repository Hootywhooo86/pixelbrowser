package expo.modules.bitshields

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.os.Build
import android.os.IBinder
import android.os.PowerManager

/**
 * Keeps Bit Browser alive while a page plays audio or video in the background
 * or with the screen off, with a media notification (play/pause/stop) and a
 * MediaSession so headphones and the lock screen controls work.
 * The controls are forwarded to JS, which plays/pauses the page's media.
 */
class BitMediaService : Service() {
  companion object {
    const val ACTION_SHOW_PLAYING = "bit.media.PLAYING"
    const val ACTION_SHOW_PAUSED = "bit.media.PAUSED"
    const val ACTION_PLAY = "bit.media.PLAY"
    const val ACTION_PAUSE = "bit.media.PAUSE"
    const val ACTION_STOP = "bit.media.STOP"
    private const val CHANNEL = "bit-media"
    private const val ID = 4128
    @Volatile var running = false
  }

  private var session: MediaSession? = null
  private var wake: PowerManager.WakeLock? = null
  private var title = ""
  private var site = ""

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    running = true
    if (Build.VERSION.SDK_INT >= 26) {
      val nm = getSystemService(NotificationManager::class.java)
      nm.createNotificationChannel(NotificationChannel(CHANNEL, "Playing in the background", NotificationManager.IMPORTANCE_LOW).apply { setShowBadge(false) })
    }
    session = MediaSession(this, "BitBrowser").apply {
      setCallback(object : MediaSession.Callback() {
        override fun onPlay() { BitMedia.controlListener?.invoke("play") }
        override fun onPause() { BitMedia.controlListener?.invoke("pause") }
        override fun onStop() { BitMedia.controlListener?.invoke("pause"); stopSelf() }
      })
      isActive = true
    }
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    intent?.getStringExtra("title")?.let { title = it }
    intent?.getStringExtra("site")?.let { site = it }
    when (intent?.action) {
      ACTION_PLAY -> BitMedia.controlListener?.invoke("play")
      ACTION_PAUSE -> BitMedia.controlListener?.invoke("pause")
      ACTION_STOP -> { BitMedia.controlListener?.invoke("pause"); stopSelf(); return START_NOT_STICKY }
    }
    val playing = intent?.action == ACTION_SHOW_PLAYING || intent?.action == ACTION_PLAY
    val notif = build(playing)
    if (playing) {
      try {
        if (Build.VERSION.SDK_INT >= 29) startForeground(ID, notif, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK) else startForeground(ID, notif)
      } catch (e: Throwable) {}
      hold(true)
    } else {
      // Paused: keep the controls but let the notification be swiped away.
      if (Build.VERSION.SDK_INT >= 24) stopForeground(STOP_FOREGROUND_DETACH) else @Suppress("DEPRECATION") stopForeground(false)
      try { (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).notify(ID, notif) } catch (e: Throwable) {}
      hold(false)
    }
    session?.setPlaybackState(
      PlaybackState.Builder()
        .setActions(PlaybackState.ACTION_PLAY or PlaybackState.ACTION_PAUSE or PlaybackState.ACTION_PLAY_PAUSE or PlaybackState.ACTION_STOP)
        .setState(if (playing) PlaybackState.STATE_PLAYING else PlaybackState.STATE_PAUSED, PlaybackState.PLAYBACK_POSITION_UNKNOWN, 1f)
        .build()
    )
    return START_NOT_STICKY
  }

  private fun hold(on: Boolean) {
    try {
      if (on && wake == null) {
        wake = (getSystemService(Context.POWER_SERVICE) as PowerManager).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "BitBrowser:media").apply { acquire(6 * 60 * 60 * 1000L) }
      } else if (!on) { wake?.let { if (it.isHeld) it.release() }; wake = null }
    } catch (e: Throwable) {}
  }

  private fun action(act: String, icon: Int, label: String, code: Int): Notification.Action {
    val pi = PendingIntent.getService(this, code, Intent(this, BitMediaService::class.java).setAction(act), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    @Suppress("DEPRECATION")
    return Notification.Action.Builder(icon, label, pi).build()
  }

  private fun build(playing: Boolean): Notification {
    val open = packageManager.getLaunchIntentForPackage(packageName)?.let {
      PendingIntent.getActivity(this, 1, it, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }
    val b = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, CHANNEL) else @Suppress("DEPRECATION") Notification.Builder(this)
    b.setSmallIcon(if (playing) android.R.drawable.ic_media_play else android.R.drawable.ic_media_pause)
      .setContentTitle(title.ifBlank { "Playing in Bit Browser" })
      .setContentText(site.ifBlank { "Bit Browser" })
      .setContentIntent(open)
      .setOngoing(playing)
      .setVisibility(Notification.VISIBILITY_PUBLIC)
      .addAction(if (playing) action(ACTION_PAUSE, android.R.drawable.ic_media_pause, "Pause", 2) else action(ACTION_PLAY, android.R.drawable.ic_media_play, "Play", 3))
      .addAction(action(ACTION_STOP, android.R.drawable.ic_menu_close_clear_cancel, "Stop", 4))
      .setStyle(Notification.MediaStyle().setMediaSession(session?.sessionToken).setShowActionsInCompactView(0, 1))
    return b.build()
  }

  override fun onDestroy() {
    running = false
    hold(false)
    session?.release()
    session = null
    super.onDestroy()
  }
}
