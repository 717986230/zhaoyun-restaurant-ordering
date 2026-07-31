package at.zhaoyun.restaurant.ordering;

import android.Manifest;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothSocket;
import android.content.Context;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbManager;
import android.net.nsd.NsdManager;
import android.net.nsd.NsdServiceInfo;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.nio.charset.Charset;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

@CapacitorPlugin(
        name = "Printer",
        permissions = {
                @Permission(
                        alias = "bluetooth",
                        strings = {
                                Manifest.permission.BLUETOOTH_SCAN,
                                Manifest.permission.BLUETOOTH_CONNECT
                        }
                )
        }
)
public class PrinterPlugin extends Plugin {
    private static final String[] SERVICE_TYPES = {
            "_pdl-datastream._tcp.",
            "_printer._tcp.",
            "_ipp._tcp."
    };
    private static final UUID SPP_UUID =
            UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");
    private final ExecutorService io = Executors.newCachedThreadPool();

    @PluginMethod
    public void discover(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
                && getPermissionState("bluetooth") != PermissionState.GRANTED) {
            requestPermissionForAlias("bluetooth", call, "bluetoothPermissionResult");
            return;
        }
        discoverInternal(call);
    }

    @PermissionCallback
    private void bluetoothPermissionResult(PluginCall call) {
        discoverInternal(call);
    }

    private void discoverInternal(PluginCall call) {
        Map<String, JSObject> devices = new ConcurrentHashMap<>();
        addUsbDevices(devices);
        addBluetoothDevices(devices);
        discoverNetworkDevices(devices, call);
    }

    private void addUsbDevices(Map<String, JSObject> devices) {
        UsbManager manager = (UsbManager) getContext().getSystemService(Context.USB_SERVICE);
        for (UsbDevice device : manager.getDeviceList().values()) {
            JSObject item = new JSObject();
            item.put("id", "usb:" + device.getDeviceId());
            item.put("name", safeName(device.getProductName(), "USB Printer " + device.getDeviceId()));
            item.put("transport", "usb");
            item.put("address", String.valueOf(device.getDeviceId()));
            item.put("vendorId", device.getVendorId());
            item.put("productId", device.getProductId());
            devices.put(item.getString("id"), item);
        }
    }

    private void addBluetoothDevices(Map<String, JSObject> devices) {
        try {
            BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
            if (adapter == null) return;
            Set<BluetoothDevice> bonded = adapter.getBondedDevices();
            for (BluetoothDevice device : bonded) {
                JSObject item = new JSObject();
                item.put("id", "bluetooth:" + device.getAddress());
                item.put("name", safeName(device.getName(), "Bluetooth Printer"));
                item.put("transport", "bluetooth");
                item.put("address", device.getAddress());
                devices.put(item.getString("id"), item);
            }
        } catch (SecurityException ignored) {
            // LAN and USB results remain available when Bluetooth permission is denied.
        }
    }

    private void discoverNetworkDevices(Map<String, JSObject> devices, PluginCall call) {
        NsdManager manager = (NsdManager) getContext().getSystemService(Context.NSD_SERVICE);
        Handler handler = new Handler(Looper.getMainLooper());
        NsdManager.DiscoveryListener[] listeners = new NsdManager.DiscoveryListener[SERVICE_TYPES.length];
        AtomicBoolean resolved = new AtomicBoolean(false);

        for (int index = 0; index < SERVICE_TYPES.length; index++) {
            final int listenerIndex = index;
            listeners[index] = new NsdManager.DiscoveryListener() {
                @Override
                public void onDiscoveryStarted(String serviceType) {}

                @Override
                public void onServiceFound(NsdServiceInfo serviceInfo) {
                    manager.resolveService(serviceInfo, new NsdManager.ResolveListener() {
                        @Override
                        public void onResolveFailed(NsdServiceInfo info, int errorCode) {}

                        @Override
                        public void onServiceResolved(NsdServiceInfo info) {
                            if (info.getHost() == null) return;
                            String address = info.getHost().getHostAddress();
                            JSObject item = new JSObject();
                            item.put("id", "lan:" + address + ":" + info.getPort());
                            item.put("name", safeName(info.getServiceName(), "Network Printer"));
                            item.put("transport", "lan");
                            item.put("address", address);
                            item.put("port", info.getPort() > 0 ? info.getPort() : 9100);
                            item.put("serviceType", info.getServiceType());
                            devices.put(item.getString("id"), item);
                        }
                    });
                }

                @Override
                public void onServiceLost(NsdServiceInfo serviceInfo) {}

                @Override
                public void onDiscoveryStopped(String serviceType) {}

                @Override
                public void onStartDiscoveryFailed(String serviceType, int errorCode) {
                    try {
                        manager.stopServiceDiscovery(listeners[listenerIndex]);
                    } catch (IllegalArgumentException ignored) {}
                }

                @Override
                public void onStopDiscoveryFailed(String serviceType, int errorCode) {}
            };
            try {
                manager.discoverServices(
                        SERVICE_TYPES[index],
                        NsdManager.PROTOCOL_DNS_SD,
                        listeners[index]
                );
            } catch (IllegalArgumentException ignored) {
                // Continue with the other service types.
            }
        }

        handler.postDelayed(() -> {
            for (NsdManager.DiscoveryListener listener : listeners) {
                try {
                    manager.stopServiceDiscovery(listener);
                } catch (IllegalArgumentException ignored) {}
            }
            if (resolved.compareAndSet(false, true)) {
                JSArray resultDevices = new JSArray();
                for (JSObject device : devices.values()) resultDevices.put(device);
                JSObject result = new JSObject();
                result.put("devices", resultDevices);
                call.resolve(result);
            }
        }, 5000);
    }

    @PluginMethod
    public void testPrint(PluginCall call) {
        String transport = call.getString("transport", "lan");
        String address = call.getString("address", "");
        int port = call.getInt("port", 9100);
        if (address.isEmpty()) {
            call.reject("Printer address is required");
            return;
        }
        if (port < 1 || port > 65535) {
            call.reject("Printer port must be between 1 and 65535");
            return;
        }
        if (!"lan".equals(transport) && !"bluetooth".equals(transport)) {
            call.reject("Unsupported printer transport");
            return;
        }
        io.execute(() -> {
            try {
                byte[] payload = testPage();
                if ("lan".equals(transport)) {
                    printLan(address, port, payload);
                } else if ("bluetooth".equals(transport)) {
                    printBluetooth(address, payload);
                } else {
                    throw new IllegalArgumentException(
                            "USB printer writing requires a model-specific driver"
                    );
                }
                JSObject result = new JSObject();
                result.put("ok", true);
                call.resolve(result);
            } catch (Exception error) {
                call.reject("Test print failed: " + error.getMessage(), error);
            }
        });
    }

    private void printLan(String address, int port, byte[] payload) throws Exception {
        try (Socket socket = new Socket()) {
            socket.connect(new InetSocketAddress(address, port), 3500);
            socket.setSoTimeout(3500);
            OutputStream output = socket.getOutputStream();
            output.write(payload);
            output.flush();
        }
    }

    private void printBluetooth(String address, byte[] payload) throws Exception {
        BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
        if (adapter == null) throw new IllegalStateException("Bluetooth is unavailable");
        BluetoothDevice device = adapter.getRemoteDevice(address);
        adapter.cancelDiscovery();
        try (BluetoothSocket socket = device.createRfcommSocketToServiceRecord(SPP_UUID)) {
            socket.connect();
            OutputStream output = socket.getOutputStream();
            output.write(payload);
            output.flush();
        }
    }

    private byte[] testPage() {
        byte[] initialize = new byte[] {0x1b, 0x40};
        byte[] cut = new byte[] {0x1d, 0x56, 0x00};
        byte[] body = (
                "ZHAO YUN RESTAURANT\n"
                        + "Printer connection test\n"
                        + "Tisch 08 / Table 08\n"
                        + new java.text.SimpleDateFormat(
                                "yyyy-MM-dd HH:mm:ss",
                                java.util.Locale.ROOT
                        ).format(new java.util.Date())
                        + "\n\n\n"
        ).getBytes(Charset.forName("GB18030"));
        byte[] payload = new byte[initialize.length + body.length + cut.length];
        System.arraycopy(initialize, 0, payload, 0, initialize.length);
        System.arraycopy(body, 0, payload, initialize.length, body.length);
        System.arraycopy(cut, 0, payload, initialize.length + body.length, cut.length);
        return payload;
    }

    private String safeName(String value, String fallback) {
        return value == null || value.trim().isEmpty() ? fallback : value;
    }
}
