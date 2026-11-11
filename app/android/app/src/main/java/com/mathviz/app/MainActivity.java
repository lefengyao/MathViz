package com.mathviz.app;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Bundle;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebChromeClient.FileChooserParams;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
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

    /* 文件上传：网页里的 <input type=file> 被点击时，WebView 会回调 onShowFileChooser。
       没有这个回调，点附件按钮完全没反应——这是套壳「不能上传」的唯一原因。 */
    private static final int REQ_PICK_ALBUM = 4001;   // 相册图片
    private static final int REQ_PICK_FILE = 4002;    // 本地文件
    private ValueCallback<Uri[]> pendingUpload;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WebView.setWebContentsDebuggingEnabled(true);

        web = new WebView(this);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);

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
        @JavascriptInterface
        public String viewerUrl(String query) {
            return VIEWER + "?" + query;
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
