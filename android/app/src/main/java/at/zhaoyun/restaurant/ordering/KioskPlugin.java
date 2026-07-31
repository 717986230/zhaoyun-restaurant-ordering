package at.zhaoyun.restaurant.ordering;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "Kiosk")
public class KioskPlugin extends Plugin {
    @PluginMethod
    public void status(PluginCall call) {
        JSObject result = new JSObject();
        result.put("configured", KioskStore.isConfigured(getContext()));
        call.resolve(result);
    }

    @PluginMethod
    public void configure(PluginCall call) {
        String pin = call.getString("pin", "");
        if (!pin.matches("\\d{6,12}")) {
            call.reject("PIN must contain 6 to 12 digits");
            return;
        }
        if (KioskStore.isConfigured(getContext())) {
            call.reject("Kiosk PIN is already configured");
            return;
        }

        KioskStore.setPin(getContext(), pin);
        call.resolve();
        getActivity().runOnUiThread(() -> activity().enableKioskMode());
    }

    @PluginMethod
    public void unlock(PluginCall call) {
        long retryAfter = KioskStore.retryAfterMs(getContext());
        if (retryAfter > 0) {
            call.reject("Too many incorrect PIN attempts. Try again in " + Math.max(1, (retryAfter + 999) / 1000) + " seconds");
            return;
        }
        String pin = call.getString("pin", "");
        if (!KioskStore.matches(getContext(), pin)) {
            KioskStore.recordFailure(getContext());
            call.reject("Incorrect PIN");
            return;
        }

        KioskStore.clearFailures(getContext());
        getActivity().runOnUiThread(() -> activity().unlockKioskMode());
        call.resolve();
    }

    @PluginMethod
    public void lock(PluginCall call) {
        getActivity().runOnUiThread(() -> activity().enableKioskMode());
        call.resolve();
    }

    private MainActivity activity() {
        return (MainActivity) getActivity();
    }
}
