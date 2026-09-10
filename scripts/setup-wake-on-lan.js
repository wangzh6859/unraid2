const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const androidDir = path.join(projectRoot, 'android');

if (!fs.existsSync(androidDir)) {
  console.log('[setup-wake-on-lan] android directory does not exist yet. Skipping direct injection.');
  process.exit(0);
}

// 1. Create wol package directory
const wolDir = path.join(androidDir, 'app/src/main/java/com/yourname/unraidmanager/wol');
fs.mkdirSync(wolDir, { recursive: true });

// 2. Write WakeOnLanModule.java
const moduleJavaPath = path.join(wolDir, 'WakeOnLanModule.java');
const moduleJavaContent = `package com.yourname.unraidmanager.wol;

import android.content.Context;
import android.net.wifi.WifiManager;
import android.os.AsyncTask;
import android.util.Log;

import androidx.annotation.NonNull;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.WritableMap;

import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.net.InterfaceAddress;
import java.net.NetworkInterface;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Enumeration;
import java.util.List;

public class WakeOnLanModule extends ReactContextBaseJavaModule {
    private static final String TAG = "WakeOnLanModule";
    private static final String MODULE_NAME = "WakeOnLan";
    private final ReactApplicationContext reactContext;

    public WakeOnLanModule(ReactApplicationContext reactContext) {
        super(reactContext);
        this.reactContext = reactContext;
    }

    @NonNull
    @Override
    public String getName() {
        return MODULE_NAME;
    }

    private byte[] parseMacAddress(String macStr) throws IllegalArgumentException {
        if (macStr == null) {
            throw new IllegalArgumentException("MAC address cannot be null");
        }
        String cleanMac = macStr.replaceAll("[^0-9A-Fa-f]", "");
        if (cleanMac.length() != 12) {
            throw new IllegalArgumentException("Invalid MAC address length: " + macStr + " (expected 12 hexadecimal characters)");
        }
        byte[] bytes = new byte[6];
        for (int i = 0; i < 6; i++) {
            bytes[i] = (byte) Integer.parseInt(cleanMac.substring(i * 2, i * 2 + 2), 16);
        }
        return bytes;
    }

    private byte[] createMagicPacket(byte[] macBytes) {
        byte[] packet = new byte[102];
        for (int i = 0; i < 6; i++) {
            packet[i] = (byte) 0xFF;
        }
        for (int i = 6; i < 102; i += 6) {
            System.arraycopy(macBytes, 0, packet, i, 6);
        }
        return packet;
    }

    private List<InetAddress> getSubnetBroadcastAddresses() {
        List<InetAddress> broadcastList = new ArrayList<>();
        try {
            Enumeration<NetworkInterface> interfaces = NetworkInterface.getNetworkInterfaces();
            if (interfaces != null) {
                for (NetworkInterface networkInterface : Collections.list(interfaces)) {
                    if (networkInterface.isLoopback() || !networkInterface.isUp()) {
                        continue;
                    }
                    for (InterfaceAddress interfaceAddress : networkInterface.getInterfaceAddresses()) {
                        InetAddress broadcast = interfaceAddress.getBroadcast();
                        if (broadcast != null && !broadcastList.contains(broadcast)) {
                            broadcastList.add(broadcast);
                        }
                    }
                }
            }
        } catch (Exception e) {
            Log.w(TAG, "Failed to enumerate network broadcast addresses: " + e.getMessage());
        }
        return broadcastList;
    }

    @ReactMethod
    public void sendWakeOnLan(String macAddress, String broadcastIp, int port, Promise promise) {
        AsyncTask.execute(() -> {
            DatagramSocket socket = null;
            WifiManager.MulticastLock multicastLock = null;
            try {
                // Acquire MulticastLock if available
                try {
                    WifiManager wifi = (WifiManager) reactContext.getApplicationContext().getSystemService(Context.WIFI_SERVICE);
                    if (wifi != null) {
                        multicastLock = wifi.createMulticastLock("WakeOnLanLock");
                        multicastLock.setReferenceCounted(true);
                        multicastLock.acquire();
                    }
                } catch (Throwable t) {
                    Log.w(TAG, "MulticastLock acquire failed: " + t.getMessage());
                }

                byte[] macBytes = parseMacAddress(macAddress);
                byte[] magicPacket = createMagicPacket(macBytes);
                int targetPort = (port > 0 && port <= 65535) ? port : 9;

                List<InetAddress> targets = new ArrayList<>();
                boolean isDefault = (broadcastIp == null || broadcastIp.trim().isEmpty() || broadcastIp.trim().equals("255.255.255.255"));

                if (isDefault) {
                    targets.add(InetAddress.getByName("255.255.255.255"));
                    List<InetAddress> subnets = getSubnetBroadcastAddresses();
                    for (InetAddress sub : subnets) {
                        if (!targets.contains(sub)) {
                            targets.add(sub);
                        }
                    }
                } else {
                    targets.add(InetAddress.getByName(broadcastIp.trim()));
                }

                socket = new DatagramSocket();
                socket.setBroadcast(true);

                int sentCount = 0;
                for (int attempt = 0; attempt < 3; attempt++) {
                    for (InetAddress targetAddr : targets) {
                        try {
                            DatagramPacket packet = new DatagramPacket(magicPacket, magicPacket.length, targetAddr, targetPort);
                            socket.send(packet);
                            sentCount++;
                        } catch (Exception sendEx) {
                            Log.w(TAG, "Failed sending to " + targetAddr + ": " + sendEx.getMessage());
                        }
                    }
                    if (attempt < 2) {
                        try {
                            Thread.sleep(150);
                        } catch (InterruptedException ignored) {}
                    }
                }

                WritableMap result = Arguments.createMap();
                result.putBoolean("success", true);
                result.putInt("packetsSent", sentCount);
                result.putString("targetMac", macAddress);
                result.putString("broadcastIp", isDefault ? "255.255.255.255" : broadcastIp.trim());
                result.putInt("port", targetPort);
                promise.resolve(result);

            } catch (Exception e) {
                Log.e(TAG, "Wake-on-LAN execution error: " + e.getMessage(), e);
                promise.reject("WOL_ERROR", "Wake-on-LAN 发送失败: " + e.getMessage(), e);
            } finally {
                if (socket != null && !socket.isClosed()) {
                    try {
                        socket.close();
                    } catch (Exception ignored) {}
                }
                if (multicastLock != null && multicastLock.isHeld()) {
                    try {
                        multicastLock.release();
                    } catch (Exception ignored) {}
                }
            }
        });
    }
}
`;
fs.writeFileSync(moduleJavaPath, moduleJavaContent, 'utf8');
console.log('[setup-wake-on-lan] Wrote WakeOnLanModule.java to:', moduleJavaPath);

// 3. Write WakeOnLanPackage.java
const packageJavaPath = path.join(wolDir, 'WakeOnLanPackage.java');
const packageJavaContent = `package com.yourname.unraidmanager.wol;

import androidx.annotation.NonNull;

import com.facebook.react.ReactPackage;
import com.facebook.react.bridge.NativeModule;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.uimanager.ViewManager;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

public class WakeOnLanPackage implements ReactPackage {
    @NonNull
    @Override
    public List<NativeModule> createNativeModules(@NonNull ReactApplicationContext reactContext) {
        List<NativeModule> modules = new ArrayList<>();
        modules.add(new WakeOnLanModule(reactContext));
        return modules;
    }

    @NonNull
    @Override
    public List<ViewManager> createViewManagers(@NonNull ReactApplicationContext reactContext) {
        return Collections.emptyList();
    }
}
`;
fs.writeFileSync(packageJavaPath, packageJavaContent, 'utf8');
console.log('[setup-wake-on-lan] Wrote WakeOnLanPackage.java to:', packageJavaPath);

// 4. Inject WakeOnLanPackage into MainApplication
const mainAppBase = path.join(androidDir, 'app/src/main/java/com/yourname/unraidmanager');
const ktFile = path.join(mainAppBase, 'MainApplication.kt');
const javaFile = path.join(mainAppBase, 'MainApplication.java');

if (fs.existsSync(ktFile)) {
  let ktContent = fs.readFileSync(ktFile, 'utf8');
  if (!ktContent.includes('WakeOnLanPackage')) {
    if (ktContent.includes('PackageList(this).packages.apply {')) {
      ktContent = ktContent.replace(
        'PackageList(this).packages.apply {',
        'PackageList(this).packages.apply {\n              add(com.yourname.unraidmanager.wol.WakeOnLanPackage())'
      );
    } else if (ktContent.includes('val packages = PackageList(this).packages')) {
      ktContent = ktContent.replace(
        'return packages',
        'packages.add(com.yourname.unraidmanager.wol.WakeOnLanPackage())\n            return packages'
      );
    } else if (ktContent.includes('PackageList(this).packages')) {
      ktContent = ktContent.replace(
        'PackageList(this).packages',
        'PackageList(this).packages.apply { add(com.yourname.unraidmanager.wol.WakeOnLanPackage()) }'
      );
    }
    fs.writeFileSync(ktFile, ktContent, 'utf8');
    console.log('[setup-wake-on-lan] Successfully registered WakeOnLanPackage in MainApplication.kt');
  } else {
    console.log('[setup-wake-on-lan] MainApplication.kt already contains WakeOnLanPackage');
  }
} else if (fs.existsSync(javaFile)) {
  let javaContent = fs.readFileSync(javaFile, 'utf8');
  if (!javaContent.includes('WakeOnLanPackage')) {
    if (javaContent.includes('return packages;')) {
      javaContent = javaContent.replace(
        'return packages;',
        'packages.add(new com.yourname.unraidmanager.wol.WakeOnLanPackage());\n      return packages;'
      );
    }
    fs.writeFileSync(javaFile, javaContent, 'utf8');
    console.log('[setup-wake-on-lan] Successfully registered WakeOnLanPackage in MainApplication.java');
  } else {
    console.log('[setup-wake-on-lan] MainApplication.java already contains WakeOnLanPackage');
  }
} else {
  console.log('[setup-wake-on-lan] MainApplication not found at:', mainAppBase);
}

// 5. Ensure permissions in AndroidManifest.xml
const manifestFile = path.join(androidDir, 'app/src/main/AndroidManifest.xml');
if (fs.existsSync(manifestFile)) {
  let manifestContent = fs.readFileSync(manifestFile, 'utf8');
  const perms = [
    '<uses-permission android:name="android.permission.CHANGE_WIFI_MULTICAST_STATE"/>',
    '<uses-permission android:name="android.permission.ACCESS_WIFI_STATE"/>'
  ];
  let changed = false;
  perms.forEach(perm => {
    if (!manifestContent.includes(perm)) {
      manifestContent = manifestContent.replace('</manifest>', `  ${perm}\n</manifest>`);
      changed = true;
    }
  });
  if (changed) {
    fs.writeFileSync(manifestFile, manifestContent, 'utf8');
    console.log('[setup-wake-on-lan] Added WiFi multicast permissions to AndroidManifest.xml');
  }
}
