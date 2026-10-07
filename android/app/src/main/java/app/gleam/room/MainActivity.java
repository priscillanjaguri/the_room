package app.gleam.room;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.webkit.PermissionRequest;
import androidx.core.content.ContextCompat;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;
import java.util.Arrays;

public class MainActivity extends BridgeActivity {
    private boolean chromeSet;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(MicPlugin.class);
        super.onCreate(savedInstanceState);
    }

    @Override
    public void onStart() {
        super.onStart();
        if (chromeSet || getBridge() == null || getBridge().getWebView() == null) return;
        getBridge().getWebView().setWebChromeClient(new RoomChrome());
        chromeSet = true;
    }

    /// Grants the WebView the mic when Android already allowed RECORD_AUDIO. Capacitor's own
    /// prompt also asks for MODIFY_AUDIO_SETTINGS, which Xiaomi often answers "no" even when the
    /// microphone itself is allowed, so the WebView never gets the mic.
    private class RoomChrome extends BridgeWebChromeClient {
        RoomChrome() {
            super(getBridge());
        }

        @Override
        public void onPermissionRequest(final PermissionRequest request) {
            boolean audio = Arrays.asList(request.getResources()).contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE);
            boolean camera = Arrays.asList(request.getResources()).contains(PermissionRequest.RESOURCE_VIDEO_CAPTURE);
            if (audio && !camera && ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                request.grant(request.getResources());
                return;
            }
            super.onPermissionRequest(request);
        }
    }
}
