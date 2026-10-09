package com.felixh.vanillacremeradio

import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.Metadata
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.extractor.metadata.icy.IcyInfo
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture

/**
 * Nativer Radio-Player (Media3/ExoPlayer) als Hintergrunddienst.
 * Spielt weiter bei gesperrtem Bildschirm und zeigt Steuerung in der
 * Benachrichtigung und auf dem Sperrbildschirm.
 */
@OptIn(UnstableApi::class)
class PlaybackService : MediaSessionService() {
  private var mediaSession: MediaSession? = null

  companion object {
    /** Aktueller Songtitel aus den ICY-Metadaten des Streams. */
    @Volatile var icyTitle: String = ""
    /** Letzter Wiedergabefehler (leer, wenn alles läuft). */
    @Volatile var lastError: String = ""
  }

  override fun onCreate() {
    super.onCreate()

    val httpFactory = DefaultHttpDataSource.Factory()
      .setUserAgent("VanillaCremeRadio/1.0")
      // Viele Sender leiten von http auf https um (oder umgekehrt).
      .setAllowCrossProtocolRedirects(true)
      .setConnectTimeoutMs(15_000)
      .setReadTimeoutMs(20_000)

    val player = ExoPlayer.Builder(this)
      .setMediaSourceFactory(DefaultMediaSourceFactory(DefaultDataSource.Factory(this, httpFactory)))
      .setAudioAttributes(
        AudioAttributes.Builder()
          .setUsage(C.USAGE_MEDIA)
          .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
          .build(),
        /* handleAudioFocus = */ true
      )
      .setHandleAudioBecomingNoisy(true)
      // Hält WLAN und CPU wach, solange gestreamt wird.
      .setWakeMode(C.WAKE_MODE_NETWORK)
      .build()

    player.addListener(object : Player.Listener {
      override fun onMetadata(metadata: Metadata) {
        for (i in 0 until metadata.length()) {
          val entry = metadata.get(i)
          if (entry is IcyInfo) icyTitle = entry.title ?: ""
        }
      }

      override fun onPlayerError(error: PlaybackException) {
        lastError = error.errorCodeName
      }

      override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
        icyTitle = ""
        lastError = ""
      }
    })

    mediaSession = MediaSession.Builder(this, player)
      .setCallback(object : MediaSession.Callback {
        // Die App übergibt die Stream-Adresse zusätzlich in requestMetadata.
        // Daraus wird hier das abspielbare MediaItem gebaut.
        override fun onAddMediaItems(
          mediaSession: MediaSession,
          controller: MediaSession.ControllerInfo,
          mediaItems: MutableList<MediaItem>
        ): ListenableFuture<MutableList<MediaItem>> {
          val resolved = mediaItems.map { item ->
            val uri = item.requestMetadata.mediaUri
            if (item.localConfiguration == null && uri != null) item.buildUpon().setUri(uri).build() else item
          }.toMutableList()
          return Futures.immediateFuture(resolved)
        }
      })
      .build()
  }

  override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? = mediaSession

  override fun onDestroy() {
    mediaSession?.run {
      player.release()
      release()
    }
    mediaSession = null
    super.onDestroy()
  }
}
