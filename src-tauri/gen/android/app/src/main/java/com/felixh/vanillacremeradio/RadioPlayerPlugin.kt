package com.felixh.vanillacremeradio

import android.Manifest
import android.app.Activity
import android.content.ComponentName
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.webkit.WebView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.Player
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import com.google.common.util.concurrent.ListenableFuture

@InvokeArg
class PlayArgs {
  var url: String = ""
  var title: String? = null
  var artist: String? = null
}

@InvokeArg
class VolumeArgs {
  var volume: Float = 1f
}

/**
 * Brücke zwischen der App-Oberfläche und dem nativen Player (PlaybackService).
 * Die Oberfläche ruft play/pause/resume/stop/setVolume und fragt den Zustand
 * per status ab.
 */
@TauriPlugin
class RadioPlayerPlugin(private val activity: Activity) : Plugin(activity) {
  private var controllerFuture: ListenableFuture<MediaController>? = null
  private var controller: MediaController? = null

  override fun load(webView: WebView) {
    super.load(webView)
    requestNotificationPermission()
    activity.runOnUiThread { withController { } }
  }

  override fun onDestroy(activity: AppCompatActivity) {
    controllerFuture?.let { MediaController.releaseFuture(it) }
    controllerFuture = null
    controller = null
  }

  /** Verbindet sich (einmalig) mit dem PlaybackService. Muss auf dem UI-Thread laufen. */
  private fun withController(then: (MediaController?) -> Unit) {
    controller?.let { then(it); return }
    val future = controllerFuture ?: MediaController.Builder(
      activity,
      SessionToken(activity, ComponentName(activity, PlaybackService::class.java))
    ).buildAsync().also { controllerFuture = it }

    future.addListener({
      try {
        val c = future.get()
        controller = c
        then(c)
      } catch (e: Exception) {
        controllerFuture = null
        then(null)
      }
    }, ContextCompat.getMainExecutor(activity))
  }

  private fun requestNotificationPermission() {
    // Ab Android 13 braucht die Wiedergabe-Benachrichtigung eine Erlaubnis.
    if (Build.VERSION.SDK_INT >= 33 &&
      ContextCompat.checkSelfPermission(activity, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
    ) {
      ActivityCompat.requestPermissions(activity, arrayOf(Manifest.permission.POST_NOTIFICATIONS), 4711)
    }
  }

  @Command
  fun play(invoke: Invoke) {
    val args = invoke.parseArgs(PlayArgs::class.java)
    activity.runOnUiThread {
      withController { c ->
        if (c == null) {
          invoke.reject("Player nicht verfügbar")
          return@withController
        }
        PlaybackService.icyTitle = ""
        PlaybackService.lastError = ""
        val item = MediaItem.Builder()
          .setUri(args.url)
          .setRequestMetadata(MediaItem.RequestMetadata.Builder().setMediaUri(Uri.parse(args.url)).build())
          .setMediaMetadata(
            MediaMetadata.Builder()
              .setTitle(args.title)
              .setArtist(args.artist)
              .build()
          )
          .build()
        c.setMediaItem(item)
        c.prepare()
        c.play()
        invoke.resolve()
      }
    }
  }

  @Command
  fun pause(invoke: Invoke) {
    activity.runOnUiThread {
      controller?.pause()
      invoke.resolve()
    }
  }

  @Command
  fun resume(invoke: Invoke) {
    activity.runOnUiThread {
      controller?.let { c ->
        // Nach einem Abbruch steht der Player auf IDLE und muss neu vorbereitet werden.
        if (c.playbackState == Player.STATE_IDLE || c.playbackState == Player.STATE_ENDED) {
          PlaybackService.lastError = ""
          c.prepare()
        }
        c.play()
      }
      invoke.resolve()
    }
  }

  @Command
  fun stop(invoke: Invoke) {
    activity.runOnUiThread {
      controller?.stop()
      controller?.clearMediaItems()
      invoke.resolve()
    }
  }

  @Command
  fun setVolume(invoke: Invoke) {
    val args = invoke.parseArgs(VolumeArgs::class.java)
    activity.runOnUiThread {
      controller?.setVolume(args.volume)
      invoke.resolve()
    }
  }

  @Command
  fun status(invoke: Invoke) {
    activity.runOnUiThread {
      val result = JSObject()
      val c = controller
      val state = when {
        c == null -> "idle"
        c.isPlaying -> "playing"
        c.playbackState == Player.STATE_IDLE && PlaybackService.lastError.isNotEmpty() -> "error"
        c.playbackState == Player.STATE_ENDED -> "ended"
        c.playWhenReady && c.mediaItemCount > 0 -> "buffering"
        c.mediaItemCount > 0 -> "paused"
        else -> "idle"
      }
      result.put("state", state)
      result.put("title", PlaybackService.icyTitle)
      result.put("error", PlaybackService.lastError)
      result.put("url", c?.currentMediaItem?.localConfiguration?.uri?.toString() ?: "")
      invoke.resolve(result)
    }
  }
}
