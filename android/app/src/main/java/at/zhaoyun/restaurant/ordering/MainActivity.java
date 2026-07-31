package at.zhaoyun.restaurant.ordering;

import android.app.admin.DevicePolicyManager;
import android.content.ComponentName;
import android.content.Context;
import android.os.Bundle;
import android.view.View;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private boolean adminUnlocked;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(KioskPlugin.class);
        registerPlugin(PrinterPlugin.class);
        super.onCreate(savedInstanceState);
        applyImmersiveMode();
    }

    @Override
    public void onResume() {
        super.onResume();
        if (KioskStore.isConfigured(this) && !adminUnlocked) {
            getWindow().getDecorView().postDelayed(this::enableKioskMode, 500);
        }
    }

    @Override
    public void onBackPressed() {
        if (KioskStore.isConfigured(this) && !adminUnlocked) {
            applyImmersiveMode();
            return;
        }
        super.onBackPressed();
    }

    void enableKioskMode() {
        adminUnlocked = false;
        applyImmersiveMode();

        DevicePolicyManager policy =
                (DevicePolicyManager) getSystemService(Context.DEVICE_POLICY_SERVICE);
        ComponentName admin = new ComponentName(this, KioskDeviceAdminReceiver.class);
        if (policy.isDeviceOwnerApp(getPackageName())) {
            policy.setLockTaskPackages(admin, new String[] {getPackageName()});
        }

        try {
            startLockTask();
        } catch (IllegalArgumentException | IllegalStateException ignored) {
            // Immersive mode remains active if this device cannot start lock task mode.
        }
    }

    void unlockKioskMode() {
        adminUnlocked = true;
        try {
            stopLockTask();
        } catch (IllegalArgumentException | IllegalStateException ignored) {
            // The activity may not currently be pinned.
        }
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_VISIBLE);
    }

    private void applyImmersiveMode() {
        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                        | View.SYSTEM_UI_FLAG_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
    }
}
