package com.mathviz.probe;

import android.app.Activity;
import android.os.Bundle;
import android.util.Log;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/**
 * 一次性 DOM 探针：用系统 WebView 原样加载 DeepSeek 网页，并打开 CDP 调试。
 * 不注入任何脚本、不碰 Cookie / localStorage，只用来观察真实页面结构。
 *
 *   adb shell am start -n com.mathviz.probe/.MainActivity -e url https://chat.deepseek.com
 */
public class MainActivity extends Activity {
    private static final String TAG = "MathVizProbe";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WebView.setWebContentsDebuggingEnabled(true);

        WebView web = new WebView(this);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        web.setWebViewClient(new WebViewClient());

        String url = getIntent().getStringExtra("url");
        if (url == null || url.isEmpty()) url = "https://chat.deepseek.com";
        Log.i(TAG, "UA=" + s.getUserAgentString());
        Log.i(TAG, "URL=" + url);
        web.loadUrl(url);
    }
}
