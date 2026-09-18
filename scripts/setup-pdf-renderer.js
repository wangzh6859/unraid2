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
import android.net.Uri;
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
import java.io.FileNotFoundException;
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

    private ParcelFileDescriptor openPfd(String rawPath) throws Exception {
        if (rawPath == null || rawPath.trim().isEmpty()) {
            throw new FileNotFoundException("PDF 文件路径为空");
        }
        if (rawPath.startsWith("content://")) {
            Uri uri = Uri.parse(rawPath);
            ParcelFileDescriptor pfd = reactContext.getContentResolver().openFileDescriptor(uri, "r");
            if (pfd == null) throw new FileNotFoundException("无法打开系统文档内容: " + rawPath);
            return pfd;
        }
        File file = resolveFile(rawPath);
        if (file == null || !file.exists() || !file.isFile() || file.length() == 0) {
            throw new FileNotFoundException("PDF 文件不存在或为空: " + rawPath);
        }
        return ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY);
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
                pfd = openPfd(filePath);
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

                long fileSize = 0;
                if (filePath.startsWith("content://")) {
                    try {
                        fileSize = pfd.getStatSize();
                    } catch (Exception ignored) {}
                } else {
                    File file = resolveFile(filePath);
                    if (file != null) fileSize = file.length();
                }

                WritableMap map = Arguments.createMap();
                map.putInt("pageCount", pageCount);
                map.putInt("width", width);
                map.putInt("height", height);
                map.putDouble("fileSize", (double) fileSize);
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
                    File cacheDir = new File(reactContext.getCacheDir(), "pdf_rendered");
                    if (!cacheDir.exists()) {
                        cacheDir.mkdirs();
                    }

                    int effectiveDpi = (dpi >= 72 && dpi <= 300) ? dpi : 144;
                    String fileKey = filePath;
                    if (!filePath.startsWith("content://")) {
                        File file = resolveFile(filePath);
                        if (file != null && file.exists()) {
                            fileKey = file.getAbsolutePath() + "_" + file.lastModified() + "_" + file.length();
                        }
                    }
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

                    pfd = openPfd(filePath);
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

// 2.1 Write SafCacheModule.java
const safCacheJavaPath = path.join(pdfDir, 'SafCacheModule.java');
const safCacheJavaContent = `package com.yourname.unraidmanager.pdf;

import android.net.Uri;
import android.os.AsyncTask;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.documentfile.provider.DocumentFile;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.WritableArray;
import com.facebook.react.bridge.WritableMap;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URLDecoder;

public class SafCacheModule extends ReactContextBaseJavaModule {
    private static final String TAG = "SafCacheModule";
    private static final String MODULE_NAME = "SafCache";
    private final ReactApplicationContext reactContext;

    public SafCacheModule(ReactApplicationContext reactContext) {
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

    private String decodePath(String raw) {
        if (raw == null) return "";
        String clean = raw.startsWith("file://") ? raw.substring(7) : raw;
        if (clean.contains("%")) {
            try {
                return URLDecoder.decode(clean, "UTF-8");
            } catch (Exception ignored) {}
        }
        return clean;
    }

    @ReactMethod
    public void saveFileToTempDir(String treeUriOrPath, String fileName, String localTempPath, Promise promise) {
        AsyncTask.THREAD_POOL_EXECUTOR.execute(() -> {
            try {
                if (treeUriOrPath == null || treeUriOrPath.trim().isEmpty() ||
                    fileName == null || fileName.trim().isEmpty() ||
                    localTempPath == null || localTempPath.trim().isEmpty()) {
                    promise.reject("INVALID_ARGS", "参数不完整");
                    return;
                }

                File localFile = new File(decodePath(localTempPath));
                if (!localFile.exists() || !localFile.isFile()) {
                    promise.reject("SOURCE_NOT_FOUND", "本地临时文件不存在: " + localTempPath);
                    return;
                }

                if (treeUriOrPath.startsWith("content://")) {
                    Uri treeUri = Uri.parse(treeUriOrPath);
                    DocumentFile rootDir = DocumentFile.fromTreeUri(reactContext, treeUri);
                    if (rootDir == null || !rootDir.exists()) {
                        promise.reject("ROOT_NOT_FOUND", "无法访问授权下载目录: " + treeUriOrPath);
                        return;
                    }

                    // 1. 查找或创建 temp 子文件夹
                    DocumentFile tempDir = rootDir.findFile("temp");
                    if (tempDir == null || !tempDir.isDirectory()) {
                        tempDir = rootDir.createDirectory("temp");
                    }
                    if (tempDir == null || !tempDir.isDirectory()) {
                        promise.reject("CREATE_DIR_FAILED", "无法在授权目录下创建 temp 子文件夹");
                        return;
                    }

                    // 2. 若 temp 文件夹内已有同名文件，先删除旧文件以覆盖
                    DocumentFile existing = tempDir.findFile(fileName);
                    if (existing != null && existing.isFile()) {
                        existing.delete();
                    }

                    // 3. 在 temp 子文件夹中创建目标文件
                    DocumentFile destDoc = tempDir.createFile("application/octet-stream", fileName);
                    if (destDoc == null) {
                        promise.reject("CREATE_FILE_FAILED", "无法在 temp 目录下创建文件: " + fileName);
                        return;
                    }

                    InputStream in = null;
                    OutputStream out = null;
                    try {
                        in = new FileInputStream(localFile);
                        out = reactContext.getContentResolver().openOutputStream(destDoc.getUri());
                        if (out == null) {
                            promise.reject("OPEN_STREAM_FAILED", "无法打开目标文件输出流");
                            return;
                        }
                        byte[] buffer = new byte[32768];
                        int read;
                        while ((read = in.read(buffer)) != -1) {
                            out.write(buffer, 0, read);
                        }
                        out.flush();
                    } finally {
                        if (in != null) { try { in.close(); } catch (Exception ignored) {} }
                        if (out != null) { try { out.close(); } catch (Exception ignored) {} }
                    }

                    promise.resolve(destDoc.getUri().toString());
                } else {
                    File rootDir = new File(decodePath(treeUriOrPath));
                    File tempDir = new File(rootDir, "temp");
                    if (!tempDir.exists()) {
                        tempDir.mkdirs();
                    }

                    File destFile = new File(tempDir, fileName);
                    InputStream in = null;
                    OutputStream out = null;
                    try {
                        in = new FileInputStream(localFile);
                        out = new FileOutputStream(destFile);
                        byte[] buffer = new byte[32768];
                        int read;
                        while ((read = in.read(buffer)) != -1) {
                            out.write(buffer, 0, read);
                        }
                        out.flush();
                    } finally {
                        if (in != null) { try { in.close(); } catch (Exception ignored) {} }
                        if (out != null) { try { out.close(); } catch (Exception ignored) {} }
                    }

                    promise.resolve("file://" + destFile.getAbsolutePath());
                }
            } catch (Exception e) {
                Log.e(TAG, "saveFileToTempDir error: " + e.getMessage(), e);
                promise.reject("SAVE_FAILED", e.getMessage(), e);
            }
        });
    }

    @ReactMethod
    public void listTempFiles(String treeUriOrPath, Promise promise) {
        AsyncTask.THREAD_POOL_EXECUTOR.execute(() -> {
            try {
                WritableArray array = Arguments.createArray();
                if (treeUriOrPath == null || treeUriOrPath.trim().isEmpty()) {
                    promise.resolve(array);
                    return;
                }

                if (treeUriOrPath.startsWith("content://")) {
                    Uri treeUri = Uri.parse(treeUriOrPath);
                    DocumentFile rootDir = DocumentFile.fromTreeUri(reactContext, treeUri);
                    if (rootDir != null && rootDir.exists()) {
                        DocumentFile tempDir = rootDir.findFile("temp");
                        // 严密安全界限：仅统计 temp 子文件夹中的普通文件，绝不触碰 rootDir
                        if (tempDir != null && tempDir.isDirectory()) {
                            DocumentFile[] children = tempDir.listFiles();
                            if (children != null) {
                                for (DocumentFile f : children) {
                                    if (f.isFile()) {
                                        WritableMap item = Arguments.createMap();
                                        item.putString("name", f.getName());
                                        item.putString("uri", f.getUri().toString());
                                        item.putDouble("size", (double) f.length());
                                        item.putDouble("mtime", (double) f.lastModified());
                                        array.pushMap(item);
                                    }
                                }
                            }
                        }
                    }
                } else {
                    File tempDir = new File(decodePath(treeUriOrPath), "temp");
                    if (tempDir.exists() && tempDir.isDirectory()) {
                        File[] children = tempDir.listFiles();
                        if (children != null) {
                            for (File f : children) {
                                if (f.isFile()) {
                                    WritableMap item = Arguments.createMap();
                                    item.putString("name", f.getName());
                                    item.putString("uri", "file://" + f.getAbsolutePath());
                                    item.putDouble("size", (double) f.length());
                                    item.putDouble("mtime", (double) f.lastModified());
                                    array.pushMap(item);
                                }
                            }
                        }
                    }
                }

                promise.resolve(array);
            } catch (Exception e) {
                Log.e(TAG, "listTempFiles error: " + e.getMessage(), e);
                promise.resolve(Arguments.createArray());
            }
        });
    }

    @ReactMethod
    public void clearTempDir(String treeUriOrPath, Promise promise) {
        AsyncTask.THREAD_POOL_EXECUTOR.execute(() -> {
            try {
                int deletedCount = 0;
                if (treeUriOrPath != null && !treeUriOrPath.trim().isEmpty()) {
                    if (treeUriOrPath.startsWith("content://")) {
                        Uri treeUri = Uri.parse(treeUriOrPath);
                        DocumentFile rootDir = DocumentFile.fromTreeUri(reactContext, treeUri);
                        if (rootDir != null && rootDir.exists()) {
                            DocumentFile tempDir = rootDir.findFile("temp");
                            // 严密安全防护：
                            // 1. 仅当 temp 子文件夹存在且是目录时处理
                            // 2. 仅删除 temp 目录下的文件，绝不删除 temp 文件夹本身！
                            // 3. 绝不触碰 rootDir（下载根目录），绝不删除下载根目录中的任何文件！
                            if (tempDir != null && tempDir.isDirectory()) {
                                DocumentFile[] children = tempDir.listFiles();
                                if (children != null) {
                                    for (DocumentFile f : children) {
                                        if (f.isFile()) {
                                            f.delete();
                                            deletedCount++;
                                        }
                                    }
                                }
                            }
                        }
                    } else {
                        File tempDir = new File(decodePath(treeUriOrPath), "temp");
                        if (tempDir.exists() && tempDir.isDirectory()) {
                            File[] children = tempDir.listFiles();
                            if (children != null) {
                                for (File f : children) {
                                    if (f.isFile()) {
                                        f.delete();
                                        deletedCount++;
                                    }
                                }
                            }
                        }
                    }
                }
                promise.resolve(deletedCount);
            } catch (Exception e) {
                Log.e(TAG, "clearTempDir error: " + e.getMessage(), e);
                promise.reject("CLEAR_FAILED", e.getMessage(), e);
            }
        });
    }

    @ReactMethod
    public void deleteTempFile(String fileUriOrPath, Promise promise) {
        AsyncTask.THREAD_POOL_EXECUTOR.execute(() -> {
            try {
                if (fileUriOrPath != null && !fileUriOrPath.trim().isEmpty()) {
                    if (fileUriOrPath.startsWith("content://")) {
                        DocumentFile df = DocumentFile.fromSingleUri(reactContext, Uri.parse(fileUriOrPath));
                        if (df != null && df.exists() && df.isFile()) {
                            df.delete();
                        }
                    } else {
                        File f = new File(decodePath(fileUriOrPath));
                        if (f.exists() && f.isFile()) {
                            f.delete();
                        }
                    }
                }
                promise.resolve(true);
            } catch (Exception e) {
                promise.resolve(false);
            }
        });
    }
}
`;
fs.writeFileSync(safCacheJavaPath, safCacheJavaContent, 'utf8');
console.log('[setup-pdf-renderer] Wrote SafCacheModule.java to:', safCacheJavaPath);

// 3. Write PdfRendererPackage.java (registering both PdfRenderer and SafCache)
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
        modules.add(new SafCacheModule(reactContext));
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

// 3.1 Ensure androidx.documentfile dependency in android/app/build.gradle
const appBuildGradle = path.join(androidDir, 'app/build.gradle');
if (fs.existsSync(appBuildGradle)) {
  let gradleContent = fs.readFileSync(appBuildGradle, 'utf8');
  if (!gradleContent.includes('androidx.documentfile:documentfile')) {
    gradleContent = gradleContent.replace(
      'dependencies {',
      "dependencies {\\n    implementation 'androidx.documentfile:documentfile:1.0.1'"
    );
    fs.writeFileSync(appBuildGradle, gradleContent, 'utf8');
    console.log('[setup-pdf-renderer] Added androidx.documentfile dependency to app/build.gradle');
  }
}

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
