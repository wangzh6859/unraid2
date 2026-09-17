const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const androidDir = path.join(projectRoot, 'android');

if (!fs.existsSync(androidDir)) {
  console.log('[setup-pdf-renderer] android directory does not exist yet. Skipping direct injection.');
  process.exit(0);
}

// 1. Create pdf package directory
const pdfDir = path.join(androidDir, 'app/src/main/java/com/yourname/unraidmanager/pdf');
fs.mkdirSync(pdfDir, { recursive: true });

// 2. Write PdfRendererModule.java
const moduleJavaPath = path.join(pdfDir, 'PdfRendererModule.java');
const moduleJavaContent = `package com.yourname.unraidmanager.pdf;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.pdf.PdfRenderer;
import android.os.AsyncTask;
import android.os.ParcelFileDescriptor;
import android.util.Log;

import androidx.annotation.NonNull;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.WritableMap;

import java.io.File;
import java.io.FileOutputStream;
import java.net.URLDecoder;
import java.security.MessageDigest;

public class PdfRendererModule extends ReactContextBaseJavaModule {
    private static final String TAG = "PdfRendererModule";
    private static final String MODULE_NAME = "PdfRenderer";
    private final ReactApplicationContext reactContext;
    private static final Object RENDER_LOCK = new Object();

    public PdfRendererModule(ReactApplicationContext reactContext) {
        super(reactContext);
        this.reactContext = reactContext;
    }

    @NonNull
    @Override
    public String getName() {
        return MODULE_NAME;
    }

    @ReactMethod
    public void isAvailable(Promise promise) {
        promise.resolve(true);
    }

    private File resolveFile(String rawPath) {
        if (rawPath == null || rawPath.trim().isEmpty()) return null;
        String clean = rawPath.startsWith("file://") ? rawPath.substring(7) : rawPath;
        File f = new File(clean);
        if (f.exists()) return f;

        if (clean.contains("%")) {
            try {
                String decoded = URLDecoder.decode(clean, "UTF-8");
                File df = new File(decoded);
                if (df.exists()) return df;
            } catch (Exception ignored) {}
        }
        return f;
    }

    private String getMd5(String input) {
        try {
            MessageDigest md = MessageDigest.getInstance("MD5");
            byte[] digest = md.digest(input.getBytes("UTF-8"));
            StringBuilder sb = new StringBuilder();
            for (byte b : digest) {
                sb.append(String.format("%02x", b));
            }
            return sb.toString();
        } catch (Exception e) {
            return String.valueOf(input.hashCode());
        }
    }

    @ReactMethod
    public void getPdfInfo(String filePath, Promise promise) {
        AsyncTask.THREAD_POOL_EXECUTOR.execute(() -> {
            ParcelFileDescriptor pfd = null;
            PdfRenderer renderer = null;
            try {
                File file = resolveFile(filePath);
                if (file == null || !file.exists() || !file.isFile() || file.length() == 0) {
                    promise.reject("FILE_NOT_FOUND", "PDF 文件不存在或为空: " + filePath);
                    return;
                }

                pfd = ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY);
                renderer = new PdfRenderer(pfd);
                int pageCount = renderer.getPageCount();
                int width = 0;
                int height = 0;
                if (pageCount > 0) {
                    PdfRenderer.Page page = renderer.openPage(0);
                    width = page.getWidth();
                    height = page.getHeight();
                    page.close();
                }

                WritableMap map = Arguments.createMap();
                map.putInt("pageCount", pageCount);
                map.putInt("width", width);
                map.putInt("height", height);
                map.putDouble("fileSize", (double) file.length());
                promise.resolve(map);

            } catch (Exception e) {
                Log.e(TAG, "getPdfInfo error: " + e.getMessage(), e);
                promise.reject("PDF_INFO_ERROR", "解析 PDF 元数据失败: " + e.getMessage(), e);
            } finally {
                if (renderer != null) {
                    try { renderer.close(); } catch (Exception ignored) {}
                }
                if (pfd != null) {
                    try { pfd.close(); } catch (Exception ignored) {}
                }
            }
        });
    }

    @ReactMethod
    public void renderPage(String filePath, int pageIndex, int dpi, Promise promise) {
        AsyncTask.THREAD_POOL_EXECUTOR.execute(() -> {
            synchronized (RENDER_LOCK) {
                ParcelFileDescriptor pfd = null;
                PdfRenderer renderer = null;
                PdfRenderer.Page page = null;
                Bitmap bitmap = null;
                FileOutputStream fos = null;
                try {
                    File file = resolveFile(filePath);
                    if (file == null || !file.exists() || !file.isFile()) {
                        promise.reject("FILE_NOT_FOUND", "PDF 文件不存在: " + filePath);
                        return;
                    }

                    File cacheDir = new File(reactContext.getCacheDir(), "pdf_rendered");
                    if (!cacheDir.exists()) {
                        cacheDir.mkdirs();
                    }

                    int effectiveDpi = (dpi >= 72 && dpi <= 300) ? dpi : 144;
                    String fileKey = file.getAbsolutePath() + "_" + file.lastModified() + "_" + file.length();
                    String hash = getMd5(fileKey);
                    File cachedFile = new File(cacheDir, hash + "_p" + pageIndex + "_d" + effectiveDpi + ".jpg");

                    if (cachedFile.exists() && cachedFile.length() > 0) {
                        WritableMap map = Arguments.createMap();
                        map.putString("uri", "file://" + cachedFile.getAbsolutePath());
                        map.putInt("pageIndex", pageIndex);
                        map.putBoolean("cached", true);
                        promise.resolve(map);
                        return;
                    }

                    pfd = ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY);
                    renderer = new PdfRenderer(pfd);
                    int totalPages = renderer.getPageCount();
                    if (pageIndex < 0 || pageIndex >= totalPages) {
                        promise.reject("PAGE_OUT_OF_BOUNDS", "页码 " + (pageIndex + 1) + " 超出文档总页数 (" + totalPages + ")");
                        return;
                    }

                    page = renderer.openPage(pageIndex);
                    float scale = (float) effectiveDpi / 72.0f;
                    int targetW = Math.max(1, Math.round(page.getWidth() * scale));
                    int targetH = Math.max(1, Math.round(page.getHeight() * scale));

                    // Cap maximum dimension to 4096px
                    int maxDim = 4096;
                    if (targetW > maxDim || targetH > maxDim) {
                        float downscale = Math.min((float) maxDim / targetW, (float) maxDim / targetH);
                        targetW = Math.max(1, Math.round(targetW * downscale));
                        targetH = Math.max(1, Math.round(targetH * downscale));
                    }

                    bitmap = Bitmap.createBitmap(targetW, targetH, Bitmap.Config.ARGB_8888);
                    Canvas canvas = new Canvas(bitmap);
                    canvas.drawColor(Color.WHITE);

                    page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY);

                    fos = new FileOutputStream(cachedFile);
                    bitmap.compress(Bitmap.CompressFormat.JPEG, 90, fos);
                    fos.flush();

                    WritableMap map = Arguments.createMap();
                    map.putString("uri", "file://" + cachedFile.getAbsolutePath());
                    map.putInt("pageIndex", pageIndex);
                    map.putInt("width", targetW);
                    map.putInt("height", targetH);
                    map.putBoolean("cached", false);
                    promise.resolve(map);

                } catch (Exception e) {
                    Log.e(TAG, "renderPage error on page " + pageIndex + ": " + e.getMessage(), e);
                    promise.reject("RENDER_ERROR", "渲染 PDF 页面失败: " + e.getMessage(), e);
                } finally {
                    if (fos != null) {
                        try { fos.close(); } catch (Exception ignored) {}
                    }
                    if (bitmap != null && !bitmap.isRecycled()) {
                        try { bitmap.recycle(); } catch (Exception ignored) {}
                    }
                    if (page != null) {
                        try { page.close(); } catch (Exception ignored) {}
                    }
                    if (renderer != null) {
                        try { renderer.close(); } catch (Exception ignored) {}
                    }
                    if (pfd != null) {
                        try { pfd.close(); } catch (Exception ignored) {}
                    }
                }
            }
        });
    }

    @ReactMethod
    public void clearCache(Promise promise) {
        AsyncTask.THREAD_POOL_EXECUTOR.execute(() -> {
            try {
                File cacheDir = new File(reactContext.getCacheDir(), "pdf_rendered");
                if (cacheDir.exists() && cacheDir.isDirectory()) {
                    File[] files = cacheDir.listFiles();
                    if (files != null) {
                        for (File f : files) {
                            f.delete();
                        }
                    }
                }
                promise.resolve(true);
            } catch (Exception e) {
                promise.reject("CLEAR_CACHE_ERROR", e.getMessage(), e);
            }
        });
    }
}
`;
fs.writeFileSync(moduleJavaPath, moduleJavaContent, 'utf8');
console.log('[setup-pdf-renderer] Wrote PdfRendererModule.java to:', moduleJavaPath);

// 3. Write PdfRendererPackage.java
const packageJavaPath = path.join(pdfDir, 'PdfRendererPackage.java');
const packageJavaContent = `package com.yourname.unraidmanager.pdf;

import androidx.annotation.NonNull;

import com.facebook.react.ReactPackage;
import com.facebook.react.bridge.NativeModule;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.uimanager.ViewManager;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

public class PdfRendererPackage implements ReactPackage {
    @NonNull
    @Override
    public List<NativeModule> createNativeModules(@NonNull ReactApplicationContext reactContext) {
        List<NativeModule> modules = new ArrayList<>();
        modules.add(new PdfRendererModule(reactContext));
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
console.log('[setup-pdf-renderer] Wrote PdfRendererPackage.java to:', packageJavaPath);

// 4. Inject PdfRendererPackage into MainApplication
const mainAppBase = path.join(androidDir, 'app/src/main/java/com/yourname/unraidmanager');
const ktFile = path.join(mainAppBase, 'MainApplication.kt');
const javaFile = path.join(mainAppBase, 'MainApplication.java');

if (fs.existsSync(ktFile)) {
  let ktContent = fs.readFileSync(ktFile, 'utf8');
  if (!ktContent.includes('PdfRendererPackage')) {
    if (ktContent.includes('WakeOnLanPackage()')) {
      ktContent = ktContent.replace(
        'WakeOnLanPackage())',
        'WakeOnLanPackage())\n              add(com.yourname.unraidmanager.pdf.PdfRendererPackage())'
      );
    } else if (ktContent.includes('PackageList(this).packages.apply {')) {
      ktContent = ktContent.replace(
        'PackageList(this).packages.apply {',
        'PackageList(this).packages.apply {\n              add(com.yourname.unraidmanager.pdf.PdfRendererPackage())'
      );
    } else if (ktContent.includes('val packages = PackageList(this).packages')) {
      ktContent = ktContent.replace(
        'return packages',
        'packages.add(com.yourname.unraidmanager.pdf.PdfRendererPackage())\n            return packages'
      );
    } else if (ktContent.includes('PackageList(this).packages')) {
      ktContent = ktContent.replace(
        'PackageList(this).packages',
        'PackageList(this).packages.apply {\n              add(com.yourname.unraidmanager.pdf.PdfRendererPackage())\n            }'
      );
    }
    fs.writeFileSync(ktFile, ktContent, 'utf8');
    console.log('[setup-pdf-renderer] Successfully registered PdfRendererPackage in MainApplication.kt');
  } else {
    console.log('[setup-pdf-renderer] MainApplication.kt already contains PdfRendererPackage');
  }
} else if (fs.existsSync(javaFile)) {
  let javaContent = fs.readFileSync(javaFile, 'utf8');
  if (!javaContent.includes('PdfRendererPackage')) {
    if (javaContent.includes('return packages;')) {
      javaContent = javaContent.replace(
        'return packages;',
        'packages.add(new com.yourname.unraidmanager.pdf.PdfRendererPackage());\n      return packages;'
      );
    }
    fs.writeFileSync(javaFile, javaContent, 'utf8');
    console.log('[setup-pdf-renderer] Successfully registered PdfRendererPackage in MainApplication.java');
  } else {
    console.log('[setup-pdf-renderer] MainApplication.java already contains PdfRendererPackage');
  }
} else {
  console.log('[setup-pdf-renderer] MainApplication not found at:', mainAppBase);
}
