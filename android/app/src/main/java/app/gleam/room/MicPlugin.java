package app.gleam.room;

import android.Manifest;
import android.content.Intent;
import android.net.Uri;
import android.provider.Settings;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.PermissionState;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

@CapacitorPlugin(name = "Mic", permissions = { @Permission(alias = "mic", strings = { Manifest.permission.RECORD_AUDIO }) })
public class MicPlugin extends Plugin {
    @PluginMethod
    public void ask(PluginCall call) {
        if (getPermissionState("mic") == PermissionState.GRANTED) {
            call.resolve();
            return;
        }
        requestPermissionForAlias("mic", call, "asked");
    }

    @PermissionCallback
    private void asked(PluginCall call) {
        if (getPermissionState("mic") == PermissionState.GRANTED) call.resolve();
        else call.reject("denied");
    }

    @PluginMethod
    public void settings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
        intent.setData(Uri.parse("package:" + getContext().getPackageName()));
        getActivity().startActivity(intent);
        call.resolve();
    }
}
