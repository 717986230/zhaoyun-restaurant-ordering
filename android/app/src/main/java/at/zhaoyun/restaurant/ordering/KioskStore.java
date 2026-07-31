package at.zhaoyun.restaurant.ordering;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Base64;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;

final class KioskStore {
    private static final String PREFS = "kiosk_admin";
    private static final String HASH = "pin_hash";
    private static final String SALT = "pin_salt";
    private static final String FAILURES = "pin_failures";
    private static final String LOCKOUT_UNTIL = "pin_lockout_until";
    private static final int MAX_FAILURES = 5;
    private static final long LOCKOUT_MS = 60_000L;

    private KioskStore() {}

    static boolean isConfigured(Context context) {
        return preferences(context).contains(HASH) && preferences(context).contains(SALT);
    }

    static void setPin(Context context, String pin) {
        byte[] salt = new byte[24];
        new SecureRandom().nextBytes(salt);
        preferences(context)
                .edit()
                .putString(SALT, Base64.encodeToString(salt, Base64.NO_WRAP))
                .putString(HASH, Base64.encodeToString(hash(pin, salt), Base64.NO_WRAP))
                .apply();
    }

    static boolean matches(Context context, String pin) {
        SharedPreferences prefs = preferences(context);
        String encodedSalt = prefs.getString(SALT, "");
        String encodedHash = prefs.getString(HASH, "");
        if (encodedSalt.isEmpty() || encodedHash.isEmpty()) return false;

        byte[] expected = Base64.decode(encodedHash, Base64.NO_WRAP);
        byte[] actual = hash(pin, Base64.decode(encodedSalt, Base64.NO_WRAP));
        return MessageDigest.isEqual(expected, actual);
    }

    static long retryAfterMs(Context context) {
        return Math.max(0L, preferences(context).getLong(LOCKOUT_UNTIL, 0L) - System.currentTimeMillis());
    }

    static void recordFailure(Context context) {
        SharedPreferences prefs = preferences(context);
        int failures = prefs.getInt(FAILURES, 0) + 1;
        SharedPreferences.Editor editor = prefs.edit();
        if (failures >= MAX_FAILURES) {
            editor.putLong(LOCKOUT_UNTIL, System.currentTimeMillis() + LOCKOUT_MS).putInt(FAILURES, 0);
        } else {
            editor.putInt(FAILURES, failures);
        }
        editor.apply();
    }

    static void clearFailures(Context context) {
        preferences(context).edit().remove(FAILURES).remove(LOCKOUT_UNTIL).apply();
    }

    private static SharedPreferences preferences(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static byte[] hash(String pin, byte[] salt) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            digest.update(salt);
            return digest.digest(pin.getBytes(StandardCharsets.UTF_8));
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 is unavailable", exception);
        }
    }
}
