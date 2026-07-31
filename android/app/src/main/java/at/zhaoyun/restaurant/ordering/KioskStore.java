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
