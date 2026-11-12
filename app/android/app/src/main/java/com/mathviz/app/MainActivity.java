package com.mathviz.app;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ContentValues;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.content.res.Configuration;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.util.Log;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebChromeClient.FileChooserParams;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * MathViz 手机端：一个 WebView 装 chat.deepseek.com，页面就绪后注入同一套业务 JS。
 *
 * 三处扩展 API 的替代：
 *   chrome.runtime.getURL  → Bridge.viewerUrl → 虚拟域名 https://mathviz.local/viewer.html
 *   chrome.storage.local   → Bridge.load / save → SharedPreferences
 *   content_scripts 声明   → onPageFinished 里 evaluateJavascript(assets/inject.js)
 *
 * viewer.html 走 shouldInterceptRequest 由本地 assets 提供，iframe 仍带
 * sandbox="allow-scripts"（无 allow-same-origin），模型代码拿不到页面 DOM 与登录态。
 */
public class MainActivity extends Activity {
    private static final String TAG = "MathVizMobile";
    private static final String HOST = "mathviz.local";
    private static final String VIEWER = "https://" + HOST + "/viewer.html";
    private static final String TARGET = "https://chat.deepseek.com";
    private static final String PREFS = "mv_settings";

    /* accept 里的图片扩展名，用来判断「这次只让选图片吗」 */
    private static final Set<String> IMAGE_EXT = new HashSet<>(Arrays.asList(
            "png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "svgz", "ico",
            "tif", "tiff", "avif", "apng", "jfif", "pjp", "pjpeg", "dib"));

    private WebView web;
    private String injectScript = "";

    /* —— 全屏（edge-to-edge）适配 ——
       targetSdk 35 起 Android 15 强制窗口铺到状态栏 / 手势条下面。不接 insets 的症状就是
       顶部内容被通知栏压住、底部（侧边栏「账号 / 设置」那一栏）被手势条压住。
       做法：WebView 外面套一层 FrameLayout，按 insets 给这层加内边距；
       页面真实底色由注入的 JS 上报（chromeColor），系统栏区域刷成同一色 —— 视觉上仍是满屏，
       但可点区域全在安全区内。 */
    private FrameLayout root;
    private int chromeBg = 0xFFFFFFFF;
    private boolean debuggable;

    /* 文件上传：网页里的 <input type=file> 被点击时，WebView 会回调 onShowFileChooser。
       没有这个回调，点附件按钮完全没反应——这是套壳「不能上传」的唯一原因。 */
    private static final int REQ_PICK_ALBUM = 4001;   // 相册图片
    private static final int REQ_PICK_FILE = 4002;    // 本地文件
    private ValueCallback<Uri[]> pendingUpload;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WebView.setWebContentsDebuggingEnabled(true);

        chromeBg = defaultChromeBg();
        debuggable = (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        edgeToEdge();

        root = new FrameLayout(this);
        root.setBackgroundColor(chromeBg);

        web = new WebView(this);
        web.setBackgroundColor(chromeBg);
        root.addView(web, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(root);
        setBarIconAppearance(isLight(chromeBg));   // 视图已挂窗口，这时候设图标黑白才有效
        applyInsets(root);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        /* 关掉 WebView 自带的捏合缩放：图里的双指手势要交给页面自己处理，
           否则同一组手指会同时缩放整张网页和画布，两个都跟手。 */
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);

        web.addJavascriptInterface(new Bridge(), "MathVizBridge");
        web.setWebViewClient(new HostClient());
        web.setWebChromeClient(new HostChrome());   // 缺了它，附件按钮点了没反应

        injectScript = readAsset("inject.js");
        if (injectScript.isEmpty()) Log.e(TAG, "inject.js 为空：请先跑 node build.mjs");
        web.loadUrl(TARGET);
    }

    private String readAsset(String name) {
        try (InputStream is = getAssets().open(name)) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = is.read(buf)) > 0) out.write(buf, 0, n);
            return new String(out.toByteArray(), StandardCharsets.UTF_8);
        } catch (IOException e) {
            Log.e(TAG, "读 assets 失败: " + name, e);
            return "";
        }
    }

    /* ========================= 全屏 / 系统栏 ========================= */

    private int defaultChromeBg() {
        boolean night = (getResources().getConfiguration().uiMode
                & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
        return night ? 0xFF1A1A1A : 0xFFFFFFFF;
    }

    /** 窗口铺满整屏，系统栏透明；内容让出多少交给 insets 算 */
    private void edgeToEdge() {
        Window w = getWindow();
        if (Build.VERSION.SDK_INT >= 30) {
            w.setDecorFitsSystemWindows(false);
        } else {
            w.getDecorView().setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
        }
        if (Build.VERSION.SDK_INT >= 29) {
            w.setStatusBarContrastEnforced(false);
            w.setNavigationBarContrastEnforced(false);
        }
        if (Build.VERSION.SDK_INT >= 28) {
            WindowManager.LayoutParams lp = w.getAttributes();
            // 刘海屏：允许内容铺到挖孔区域，靠 displayCutout inset 让位
            lp.layoutInDisplayCutoutMode =
                    WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            w.setAttributes(lp);
        }
        w.setStatusBarColor(Color.TRANSPARENT);
        // Android 10 起手势条本来就透明，别再给导航栏刷色（否则多出一条色带）
        w.setNavigationBarColor(Build.VERSION.SDK_INT >= 29 ? Color.TRANSPARENT : chromeBg);
        setBarIconAppearance(isLight(chromeBg));
    }

    /**
     * 把状态栏 / 刘海 / 手势条的高度变成容器的内边距。
     *
     * 用 padding 而不是给 WebView 设 margin：只有容器真的变小，WebView 的**视口**才会变小，
     * 页面里 position:fixed 的元素（DeepSeek 的侧边栏抽屉、底部输入框）才会跟着收进来。
     * 键盘弹出时取 ime 与系统栏高度的较大者，避免和 adjustResize 叠成两份空白。
     */
    private void applyInsets(final View host) {
        host.setOnApplyWindowInsetsListener((v, insets) -> {
            int l, t, r, b;
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets bars = insets.getInsets(
                        WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                android.graphics.Insets ime = insets.getInsets(WindowInsets.Type.ime());
                l = bars.left;
                t = bars.top;
                r = bars.right;
                b = Math.max(bars.bottom, ime.bottom);
            } else {
                l = insets.getSystemWindowInsetLeft();
                t = insets.getSystemWindowInsetTop();
                r = insets.getSystemWindowInsetRight();
                b = insets.getSystemWindowInsetBottom();
            }
            /* 调试包可以用 Intent 参数模拟系统栏高度，方便在无状态栏的模拟器上验证排版：
               adb shell am start -n com.mathviz.app/.MainActivity --ei mvInsetTop 72 --ei mvInsetBottom 96 */
            if (debuggable) {
                int ft = getIntent().getIntExtra("mvInsetTop", -1);
                int fb = getIntent().getIntExtra("mvInsetBottom", -1);
                if (ft >= 0) t = ft;
                if (fb >= 0) b = fb;
            }
            if (v.getPaddingLeft() != l || v.getPaddingTop() != t
                    || v.getPaddingRight() != r || v.getPaddingBottom() != b) {
                v.setPadding(l, t, r, b);
            }
            return insets;
        });
        host.requestApplyInsets();
    }

    /** 页面底色变了：系统栏区域刷成同一色，图标黑白跟着切 */
    private void applyChromeColor(int c) {
        if ((c >>> 24) == 0) return;              // 全透明：当不了底色
        chromeBg = c;
        if (root != null) root.setBackgroundColor(c);
        if (web != null) web.setBackgroundColor(c);
        getWindow().setStatusBarColor(Color.TRANSPARENT);
        if (Build.VERSION.SDK_INT >= 29) getWindow().setNavigationBarColor(Color.TRANSPARENT);
        else getWindow().setNavigationBarColor(c);
        setBarIconAppearance(isLight(c));
    }

    private static boolean isLight(int c) {
        return Color.luminance(0xFF000000 | (c & 0x00FFFFFF)) > 0.5;
    }

    private void setBarIconAppearance(boolean lightBackground) {
        // 视图还没挂到窗口时 PhoneWindow.getInsetsController() 会 NPE，跳过，稍后再设一次
        if (getWindow().peekDecorView() == null) return;
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController c = getWindow().getInsetsController();
            if (c == null) return;
            int mask = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
                    | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
            c.setSystemBarsAppearance(lightBackground ? mask : 0, mask);
        } else {
            int flags = View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION;
            if (lightBackground) {
                flags |= View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR
                        | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
            }
            getWindow().getDecorView().setSystemUiVisibility(flags);
        }
    }

    /** 解析 JS 给的 #rgb / #rrggbb / rgb() / rgba()；解析不了返回 0 */
    private static int parseCssColor(String css) {
        if (css == null) return 0;
        String s = css.trim().toLowerCase(Locale.ROOT);
        if (s.isEmpty() || "transparent".equals(s)) return 0;
        try {
            if (s.startsWith("#")) {
                String h = s.substring(1);
                if (h.length() == 3) {
                    h = "" + h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1)
                            + h.charAt(2) + h.charAt(2);
                }
                if (h.length() == 6) return 0xFF000000 | Integer.parseInt(h, 16);
                if (h.length() == 8) return (int) Long.parseLong(h, 16);
                return 0;
            }
            if (s.startsWith("rgb")) {
                java.util.regex.Matcher m = java.util.regex.Pattern
                        .compile("[0-9]*\\.?[0-9]+").matcher(s);
                double[] v = new double[4];
                int n = 0;
                while (m.find() && n < 4) v[n++] = Double.parseDouble(m.group());
                if (n < 3) return 0;
                int a = 255;
                if (n >= 4) {
                    // CSS4 的 rgb() 允许第四个参数是 0–1 的 alpha
                    a = v[3] <= 1 ? (int) Math.round(v[3] * 255.0) : clamp255((int) Math.round(v[3]));
                }
                if (a == 0) return 0;
                return (a << 24) | (clamp255((int) Math.round(v[0])) << 16)
                        | (clamp255((int) Math.round(v[1])) << 8)
                        | clamp255((int) Math.round(v[2]));
            }
        } catch (Exception ignored) {
        }
        return 0;
    }

    private static int clamp255(int v) {
        return v < 0 ? 0 : (v > 255 ? 255 : v);
    }

    private class HostClient extends WebViewClient {
        /** 把沙箱页映射成本地文件；这个域名不联网，intercept 在 DNS/TLS 之前发生 */
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
            Uri u = req.getUrl();
            if (HOST.equals(u.getHost()) && "/viewer.html".equals(u.getPath())) {
                try {
                    InputStream is = getAssets().open("viewer.html");
                    Map<String, String> h = new HashMap<>();
                    h.put("Access-Control-Allow-Origin", "*");
                    h.put("Cache-Control", "no-store");
                    return new WebResourceResponse("text/html", "utf-8", 200, "OK", h, is);
                } catch (IOException e) {
                    Log.e(TAG, "viewer.html 打不开", e);
                }
            }
            return super.shouldInterceptRequest(view, req);
        }

        /** 外链交给系统浏览器，别让这个小窗变成任意浏览器 */
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
            Uri u = req.getUrl();
            String host = u.getHost();
            if (host != null && (host.equals("deepseek.com") || host.endsWith(".deepseek.com")
                    || HOST.equals(host))) return false;
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, u));
            } catch (Exception e) {
                Log.w(TAG, "打不开外链: " + u);
            }
            return true;
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            if (url.startsWith(TARGET) && !injectScript.isEmpty()) {
                // content.js 自带 window.__mvLoaded 防重；SPA 内跳转不触发本回调，由 MO 接管
                view.evaluateJavascript(injectScript, null);
            }
        }
    }

    /**
     * 文件选择。DeepSeek 只用一个隐藏的 input[type=file]，accept 是一长串扩展名
     * （图片、文档、代码上千项），multiple=true。
     *
     * 分流策略：
     *   accept 全是图片   → 直接开相册，少一次点击
     *   其它（就是 DeepSeek 这种情况）→ 先问「相册图片 / 本地文件」再开对应选择器
     *
     * 铁律：pendingUpload 必须在每条路径上被 onReceiveValue 收尾一次（哪怕传 null），
     * 否则 WebView 认为这次选择没结束，之后再点附件按钮永远不弹。
     */
    private class HostChrome extends WebChromeClient {
        @Override
        public boolean onShowFileChooser(WebView view, final ValueCallback<Uri[]> cb,
                                         final FileChooserParams params) {
            cancelUpload();          // 上一次没回话的先丢掉
            pendingUpload = cb;

            if (onlyImages(params)) {
                openPicker(REQ_PICK_ALBUM, imageIntent(params));
                return true;
            }
            new AlertDialog.Builder(MainActivity.this)
                    .setTitle("上传附件")
                    .setItems(new String[]{"从相册选图片", "选择文件"}, (d, which) -> {
                        if (which == 0) openPicker(REQ_PICK_ALBUM, imageIntent(params));
                        else openPicker(REQ_PICK_FILE, fileIntent(params));
                    })
                    .setOnCancelListener(d -> cancelUpload())
                    .show();
            return true;
        }
    }

    /** accept 里只有图片类型时才算「纯图片输入」 */
    private boolean onlyImages(FileChooserParams p) {
        String[] types = p == null ? null : p.getAcceptTypes();
        if (types == null || types.length == 0) return false;
        boolean sawImage = false;
        for (String raw : types) {
            if (raw == null) continue;
            for (String one : raw.toLowerCase(Locale.ROOT).split(",")) {
                String t = one.trim();
                if (t.isEmpty()) continue;
                if (t.startsWith("image/")) { sawImage = true; continue; }
                if (t.startsWith(".") && IMAGE_EXT.contains(t.substring(1))) { sawImage = true; continue; }
                return false;        // 出现了非图片类型：不是纯图片
            }
        }
        return sawImage;
    }

    private boolean multiSelect(FileChooserParams p) {
        return p != null && p.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE;
    }

    private Intent imageIntent(FileChooserParams p) {
        return pickIntent("image/*", multiSelect(p));
    }

    private Intent fileIntent(FileChooserParams p) {
        return pickIntent("*/*", multiSelect(p));
    }

    /**
     * 选择器意图。
     *
     * 单选用 GET_CONTENT（会列相册 / 文件管理器，最接近手机习惯）；
     * **多选必须用 OPEN_DOCUMENT** —— GET_CONTENT 带 EXTRA_ALLOW_MULTIPLE 时，
     * 部分 DocumentsUI（MuMu/Android 12 实测）点「选择」会直接返回 RESULT_CANCELED，
     * 表现就是「选了两张，回到聊天一个都没有」。OPEN_DOCUMENT 的多选是官方路径。
     */
    private Intent pickIntent(String mime, boolean multiple) {
        Intent i = multiple
                ? new Intent(Intent.ACTION_OPEN_DOCUMENT)
                : new Intent(Intent.ACTION_GET_CONTENT);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        i.setType(mime);
        if (multiple) i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        return i;
    }

    /** 先试 GET_CONTENT（会列相册/文件管理器），系统没有对应应用就退回 OPEN_DOCUMENT */
    private void openPicker(int req, Intent intent) {
        try {
            startActivityForResult(intent, req);
            return;
        } catch (ActivityNotFoundException e) {
            Log.w(TAG, "GET_CONTENT 无可用应用，退回 OPEN_DOCUMENT: " + intent.getType());
        }
        Intent alt = new Intent(Intent.ACTION_OPEN_DOCUMENT, intent.getData());
        alt.addCategory(Intent.CATEGORY_OPENABLE);
        alt.setType(intent.getType());
        alt.putExtras(intent);
        try {
            startActivityForResult(alt, req);
        } catch (ActivityNotFoundException e) {
            Log.e(TAG, "没有任何文件选择器可用", e);
            Toast.makeText(this, "系统里没有可用的文件选择器", Toast.LENGTH_SHORT).show();
            cancelUpload();
        }
    }

    private void cancelUpload() {
        if (pendingUpload != null) {
            pendingUpload.onReceiveValue(null);
            pendingUpload = null;
        }
    }

    /**
     * 从选择器结果里取 Uri。
     *
     * 不能直接用 WebChromeClient.FileChooserParams.parseResult：它内部要求
     * intent.getData() 非空，而多选时 DocumentsUI（MuMu / AOSP 12 实测）只塞 clipData、
     * 不设 data，于是 parseResult 返回 null，表现为「选了两张，回来一个都没有」。
     * 这里优先读 clipData，再退回 data，最后才交给 parseResult。
     */
    private Uri[] urisFromResult(Intent data) {
        ClipData clip = data.getClipData();
        if (clip != null && clip.getItemCount() > 0) {
            Uri[] out = new Uri[clip.getItemCount()];
            for (int i = 0; i < clip.getItemCount(); i++) out[i] = clip.getItemAt(i).getUri();
            return out;
        }
        if (data.getData() != null) return new Uri[]{data.getData()};
        return WebChromeClient.FileChooserParams.parseResult(Activity.RESULT_OK, data);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQ_PICK_ALBUM || requestCode == REQ_PICK_FILE) {
            Uri[] result = null;
            if (resultCode == RESULT_OK && data != null) {
                result = urisFromResult(data);
            }
            Log.i(TAG, "附件选择返回 resultCode=" + resultCode
                    + " uri=" + (result == null ? "null" : result.length + " 个")
                    + " | data=" + (data == null ? "null" : ("action=" + data.getAction()
                    + " data=" + data.getData()
                    + " clip=" + (data.getClipData() == null ? 0 : data.getClipData().getItemCount())
                    + " extras=" + data.getExtras())));
            if (pendingUpload != null) {
                pendingUpload.onReceiveValue(result);
                pendingUpload = null;
            } else {
                Log.w(TAG, "没有待处理的 input（callback 已失效）");
            }
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    private class Bridge {
        /**
         * 页面把真实底色报上来（注入脚本会盯着 body 背景变化，深浅色切换时也会重报）。
         * 原生据此给系统栏区域刷同色，全屏才看不出接缝。
         */
        @JavascriptInterface
        public void chromeColor(String css) {
            final int c = parseCssColor(css);
            if (c == 0) return;
            runOnUiThread(() -> {
                if (c != chromeBg) applyChromeColor(c);
            });
        }

        @JavascriptInterface
        public String viewerUrl(String query) {
            return VIEWER + "?" + query;
        }

        /**
         * 存图：把沙箱里渲染好的 PNG（data URL）写进系统相册。
         *
         * 为什么不让网页自己做 &lt;a download&gt;：WebView 没设 DownloadListener 时这类点击
         * 什么都不会发生，用户只会觉得按钮是坏的。
         *
         * 返回空串 = 成功；非空 = 可直接展示给用户的失败原因。
         * 这个方法跑在 JavaBridge 线程（不是 UI 线程），磁盘 IO 可以直接做。
         */
        @JavascriptInterface
        public String saveImage(String dataUrl, String name) {
            if (dataUrl == null || dataUrl.isEmpty()) return "图片数据是空的";
            try {
                int comma = dataUrl.indexOf(',');
                byte[] png = Base64.decode(comma >= 0 ? dataUrl.substring(comma + 1) : dataUrl,
                        Base64.DEFAULT);
                if (png.length < 64) return "图片数据不完整";

                String file = safeName(name);
                if (Build.VERSION.SDK_INT >= 29) {
                    ContentValues v = new ContentValues();
                    v.put(MediaStore.Images.Media.DISPLAY_NAME, file);
                    v.put(MediaStore.Images.Media.MIME_TYPE, "image/png");
                    v.put(MediaStore.Images.Media.RELATIVE_PATH,
                            Environment.DIRECTORY_PICTURES + "/MathViz");
                    v.put(MediaStore.Images.Media.IS_PENDING, 1);
                    Uri uri = getContentResolver()
                            .insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, v);
                    if (uri == null) return "相册拒绝了写入请求";
                    try (OutputStream os = getContentResolver().openOutputStream(uri)) {
                        if (os == null) throw new IOException("拿不到相册写入流");
                        os.write(png);
                    }
                    ContentValues done = new ContentValues();
                    done.put(MediaStore.Images.Media.IS_PENDING, 0);
                    getContentResolver().update(uri, done, null, null);
                } else {
                    File dir = new File(getExternalFilesDir(Environment.DIRECTORY_PICTURES), "MathViz");
                    if (!dir.exists() && !dir.mkdirs()) return "建不了目录 " + dir;
                    try (OutputStream os = new FileOutputStream(new File(dir, file))) {
                        os.write(png);
                    }
                }
                Log.i(TAG, "存图成功 " + file + "（" + png.length + " 字节）");
                runOnUiThread(() -> Toast.makeText(MainActivity.this,
                        "已存到相册 Pictures/MathViz", Toast.LENGTH_SHORT).show());
                return "";
            } catch (Exception e) {
                Log.e(TAG, "存图失败", e);
                return String.valueOf(e.getMessage());
            }
        }

        private String safeName(String name) {
            String n = (name == null || name.trim().isEmpty()) ? "mathviz" : name.trim();
            n = n.replaceAll("[\\\\/:*?\"<>|\\s]+", "_");
            if (!n.toLowerCase(Locale.ROOT).endsWith(".png")) n += ".png";
            return n;
        }

        @JavascriptInterface
        public String load() {
            SharedPreferences p = getSharedPreferences(PREFS, MODE_PRIVATE);
            try {
                return new JSONObject()
                        .put("mvMode", p.getString("mvMode", "auto"))
                        .put("mvAuto", p.getBoolean("mvAuto", false))
                        .toString();
            } catch (Exception e) {
                return "{\"mvMode\":\"auto\",\"mvAuto\":false}";
            }
        }

        @JavascriptInterface
        public void save(String json) {
            try {
                JSONObject o = new JSONObject(json);
                getSharedPreferences(PREFS, MODE_PRIVATE).edit()
                        .putString("mvMode", o.optString("mvMode", "auto"))
                        .putBoolean("mvAuto", o.optBoolean("mvAuto", false))
                        .apply();
            } catch (Exception e) {
                Log.w(TAG, "设置保存失败: " + json);
            }
        }
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }
}
