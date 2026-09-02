package at.zhaoyun.restaurant.ordering;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Base64;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.security.spec.InvalidKeySpecException;

import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.PBEKeySpec;

final class KioskStore {
    private static final String PREFS = "kiosk_admin";
    private static final String HASH = "pin_hash";
    private static final String SALT = "pin_salt";
    private static final String ALGORITHM = "pin_algorithm";
    private static final String FAILURES = "pin_failures";
    private static final String LOCKOUT_UNTIL = "pin_lockout_until";
    private static final int MAX_FAILURES = 5;
    private static final long LOCKOUT_MS = 60_000L;

    /**
     * A 6-12 digit PIN has at most 10^12 candidates, so the stored verifier has to be slow
     * on purpose. PBKDF2 with a high iteration count turns an offline guess of the whole
     * keyspace from seconds into years. ALGORITHM_LEGACY_SHA256 is the single-round digest
     * shipped before this; it is still accepted once, then upgraded in place on next unlock.
     *
     * PBKDF2WithHmacSHA256 only exists from API 26; minSdk here is 22, so older tablets fall
     * back to PBKDF2WithHmacSHA1. The algorithm actually used is stored alongside the hash so
     * a device keeps verifying against whatever it wrote.
     */
    private static final String ALGORITHM_PBKDF2_SHA256 = "pbkdf2-sha256";
    private static final String ALGORITHM_PBKDF2_SHA1 = "pbkdf2-sha1";
    private static final String ALGORITHM_LEGACY_SHA256 = "sha256";
    private static final int PBKDF2_ITERATIONS = 200_000;
    private static final int PBKDF2_KEY_BITS = 256;
    private static final int SALT_BYTES = 24;

    private KioskStore() {}

    static boolean isConfigured(Context context) {
        return preferences(context).contains(HASH) && preferences(context).contains(SALT);
    }

    static void setPin(Context context, String pin) {
        byte[] salt = new byte[SALT_BYTES];
        new SecureRandom().nextBytes(salt);
        store(context, pin, salt);
    }

    static boolean matches(Context context, String pin) {
        SharedPreferences prefs = preferences(context);
        String encodedSalt = prefs.getString(SALT, "");
        String encodedHash = prefs.getString(HASH, "");
        if (encodedSalt.isEmpty() || encodedHash.isEmpty()) return false;

        byte[] salt = Base64.decode(encodedSalt, Base64.NO_WRAP);
        byte[] expected = Base64.decode(encodedHash, Base64.NO_WRAP);
        String algorithm = prefs.getString(ALGORITHM, ALGORITHM_LEGACY_SHA256);

        if (ALGORITHM_LEGACY_SHA256.equals(algorithm)) {
            if (!MessageDigest.isEqual(expected, legacyHash(pin, salt))) return false;
            store(context, pin, salt);
            return true;
        }
        return MessageDigest.isEqual(expected, pbkdf2(pin, salt, factoryFor(algorithm)));
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

    private static void store(Context context, String pin, byte[] salt) {
        SecretKeyFactory factory = strongestFactory();
        String algorithm = "PBKDF2WithHmacSHA256".equals(factory.getAlgorithm()) ? ALGORITHM_PBKDF2_SHA256 : ALGORITHM_PBKDF2_SHA1;
        preferences(context)
                .edit()
                .putString(SALT, Base64.encodeToString(salt, Base64.NO_WRAP))
                .putString(HASH, Base64.encodeToString(pbkdf2(pin, salt, factory), Base64.NO_WRAP))
                .putString(ALGORITHM, algorithm)
                .apply();
    }

    private static SecretKeyFactory strongestFactory() {
        try {
            return SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256");
        } catch (NoSuchAlgorithmException exception) {
            return factoryFor(ALGORITHM_PBKDF2_SHA1);
        }
    }

    private static SecretKeyFactory factoryFor(String algorithm) {
        String name = ALGORITHM_PBKDF2_SHA256.equals(algorithm) ? "PBKDF2WithHmacSHA256" : "PBKDF2WithHmacSHA1";
        try {
            return SecretKeyFactory.getInstance(name);
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException(name + " is unavailable", exception);
        }
    }

    private static SharedPreferences preferences(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static byte[] pbkdf2(String pin, byte[] salt, SecretKeyFactory factory) {
        PBEKeySpec spec = new PBEKeySpec(pin.toCharArray(), salt, PBKDF2_ITERATIONS, PBKDF2_KEY_BITS);
        try {
            return factory.generateSecret(spec).getEncoded();
        } catch (InvalidKeySpecException exception) {
            throw new IllegalStateException(factory.getAlgorithm() + " rejected the PIN key spec", exception);
        } finally {
            spec.clearPassword();
        }
    }

    private static byte[] legacyHash(String pin, byte[] salt) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            digest.update(salt);
            return digest.digest(pin.getBytes(StandardCharsets.UTF_8));
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 is unavailable", exception);
        }
    }
}
