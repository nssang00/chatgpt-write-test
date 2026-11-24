package io.valdash.loginprobe

import android.annotation.SuppressLint
import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.SslErrorHandler
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.net.http.SslError
import android.widget.Button
import android.widget.LinearLayout
import android.widget.Switch
import android.widget.TextView
import android.widget.Toast
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * Login-environment comparison only. Never reads credentials, cookies, tokens,
 * page contents, request headers/bodies, or full URLs.
 * Account-site login is NOT an RSO OAuth callback or a storefront authorization.
 */
class MainActivity : Activity() {
    private lateinit var webView: WebView
    private lateinit var status: TextView
    private val events = JSONArray()
    private var outcome = "NOT_REPORTED"
    private var navigations = 0
    private var httpErrors = 0
    private var networkErrors = 0
    private var thirdPartyCookies = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WebView.setWebContentsDebuggingEnabled(false)

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(12.dp(), 10.dp(), 12.dp(), 10.dp())
            setBackgroundColor(Color.WHITE)
        }
        setContentView(root)

        root.addView(TextView(this).apply {
            text = "VAL DASH — Android WebView 로그인 진단"
            textSize = 18f
            setTextColor(Color.BLACK)
        })
        root.addView(TextView(this).apply {
            text = "Riot 계정 관리 페이지 로그인만 비교합니다. 상점 조회·OAuth 토큰 수집 기능은 없습니다."
            textSize = 12f
        })

        webView = WebView(this)
        configureWebView()

        root.addView(Button(this).apply {
            text = "공식 Riot 계정 페이지 열기"
            setOnClickListener {
                outcome = "NOT_REPORTED"
                record("open_account_page")
                webView.loadUrl("https://account.riotgames.com/")
            }
        })
        root.addView(Switch(this).apply {
            text = "제3자 쿠키 허용 (비교 실험용 · 기본 꺼짐)"
            isChecked = false
            setOnCheckedChangeListener { _, enabled ->
                thirdPartyCookies = enabled
                CookieManager.getInstance().setAcceptThirdPartyCookies(webView, enabled)
                record("third_party_cookies_changed", if (enabled) "enabled" else "disabled")
            }
        })
        val outcomeRow = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        outcomeRow.addView(actionButton("로그인 성공 표시") {
            outcome = "USER_REPORTED_SUCCESS"
            record("user_reported_login_success")
            status.text = "성공으로 표시됨 (사용자 직접 판단)"
        })
        outcomeRow.addView(actionButton("로그인 실패 표시") {
            outcome = "USER_REPORTED_FAILURE"
            record("user_reported_login_failure")
            status.text = "실패로 표시됨 (사용자 직접 판단)"
        })
        root.addView(outcomeRow)

        val toolsRow = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        toolsRow.addView(actionButton("진단 JSON 복사") { copyDiagnostics() })
        toolsRow.addView(actionButton("앱 로그인 데이터 초기화") { clearSession() })
        root.addView(toolsRow)

        status = TextView(this).apply {
            text = "대기 중 — Riot 페이지를 열어 로그인 결과를 관찰하세요."
            textSize = 12f
        }
        root.addView(status)
        root.addView(webView, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f
        ))
        record("app_started")
    }

    private fun actionButton(label: String, onClick: () -> Unit): Button =
        Button(this).apply {
            text = label
            textSize = 11f
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
            setOnClickListener { onClick() }
        }

    @SuppressLint("SetJavaScriptEnabled")
    private fun configureWebView() {
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            setSupportMultipleWindows(false)
            javaScriptCanOpenWindowsAutomatically = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            safeBrowsingEnabled = true
        }
        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, false)
        webView.webChromeClient = WebChromeClient()
        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val scheme = request.url.scheme?.lowercase(Locale.ROOT)
                if (scheme != "https") {
                    record("blocked_non_https_navigation", safeHost(request.url.toString()))
                    return true
                }
                return false
            }

            override fun onPageStarted(view: WebView, url: String, favicon: android.graphics.Bitmap?) {
                navigations++
                record("navigation_started", safeHost(url))
                status.text = "페이지 이동: " + safeHost(url)
            }

            override fun onPageFinished(view: WebView, url: String) {
                record("navigation_finished", safeHost(url))
                status.text = "페이지 로드 완료: " + safeHost(url) + " (로그인 여부는 직접 판단)"
            }

            override fun onReceivedHttpError(
                view: WebView, request: WebResourceRequest, errorResponse: WebResourceResponse
            ) {
                if (request.isForMainFrame) {
                    httpErrors++
                    record("main_frame_http_error", safeHost(request.url.toString()), errorResponse.statusCode)
                }
            }

            override fun onReceivedError(
                view: WebView, request: WebResourceRequest, error: WebResourceError
            ) {
                if (request.isForMainFrame) {
                    networkErrors++
                    record("main_frame_network_error", safeHost(request.url.toString()), error.errorCode)
                }
            }

            override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: SslError) {
                handler.cancel()
                networkErrors++
                record("ssl_error_blocked", safeHost(error.url))
            }
        }
    }

    private fun safeHost(rawUrl: String?): String {
        val host = try {
            Uri.parse(rawUrl ?: "").host?.lowercase(Locale.ROOT)
        } catch (_: Exception) { null }
        return when {
            host == "riotgames.com" || host?.endsWith(".riotgames.com") == true -> host
            host == "playvalorant.com" || host?.endsWith(".playvalorant.com") == true -> host
            else -> "other"
        }
    }

    private fun record(stage: String, host: String? = null, code: Int? = null) {
        val event = JSONObject().put("stage", stage)
        if (host != null) event.put("host", host)
        if (code != null) event.put("code", code)
        if (events.length() < 120) events.put(event)
    }

    private fun diagnostics(): String = JSONObject()
        .put("schema", 1)
        .put("created_utc", utcNow())
        .put("platform", "Android WebView")
        .put("login_target", "Riot account-management site")
        .put("third_party_cookies_allowed", thirdPartyCookies)
        .put("navigations", navigations)
        .put("main_frame_http_errors", httpErrors)
        .put("main_frame_network_errors", networkErrors)
        .put("outcome", outcome)
        .put("events", events)
        .put("note", "User-reported outcome only; no OAuth callback, passwords, tokens, cookies, URL paths or query strings.")
        .toString(2)

    private fun copyDiagnostics() {
        val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        clipboard.setPrimaryClip(ClipData.newPlainText("VAL DASH diagnostic JSON", diagnostics()))
        Toast.makeText(this, "진단 JSON을 클립보드에 복사했습니다.", Toast.LENGTH_LONG).show()
    }

    private fun clearSession() {
        webView.stopLoading()
        webView.loadUrl("about:blank")
        CookieManager.getInstance().removeAllCookies {
            CookieManager.getInstance().flush()
            android.webkit.WebStorage.getInstance().deleteAllData()
            webView.clearCache(true)
            webView.clearHistory()
            outcome = "NOT_REPORTED"
            record("app_webview_session_cleared")
            status.text = "앱 WebView 세션 초기화됨 (GO VAL/Chrome 데이터에는 영향 없음)"
        }
    }

    private fun utcNow(): String =
        SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US).apply {
            timeZone = TimeZone.getTimeZone("UTC")
        }.format(Date())

    private fun Int.dp(): Int = (this * resources.displayMetrics.density).toInt()

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (webView.canGoBack()) webView.goBack() else super.onBackPressed()
    }

    override fun onDestroy() {
        webView.stopLoading()
        (webView.parent as? ViewGroup)?.removeView(webView)
        webView.destroy()
        super.onDestroy()
    }
}
