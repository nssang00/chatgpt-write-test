package io.valdash.loginprobe

import android.app.Activity
import android.graphics.BitmapFactory
import android.graphics.Color
import android.os.Bundle
import android.text.Editable
import android.text.TextWatcher
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import org.json.JSONObject
import java.net.URL
import java.util.Locale
import java.util.concurrent.Executors
import javax.net.ssl.HttpsURLConnection

/** Public skins only. Neither Riot login session nor personal store API is accessed. */
class CatalogActivity : Activity() {
    private data class Skin(val id: String, val name: String, val icon: String?)
    private val executor = Executors.newFixedThreadPool(4)
    private val picked = mutableSetOf<String>()
    private var skins = emptyList<Skin>()
    private var pickedOnly = false
    private var renderId = 0
    private lateinit var resultArea: LinearLayout
    private lateinit var searchBox: EditText
    private lateinit var status: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        picked.addAll(getSharedPreferences("skin_selection", MODE_PRIVATE)
            .getStringSet("selected", emptySet()) ?: emptySet())
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(12), dp(12), dp(12), dp(12))
            setBackgroundColor(Color.WHITE)
        }
        setContentView(root)
        root.addView(TextView(this).apply {
            text = "VAL DASH · 공개 스킨 도감"
            textSize = 21f
            setTextColor(Color.BLACK)
        })
        root.addView(TextView(this).apply {
            text = "이 목록은 실제 내 일일 상점이 아닙니다. Riot 계정 사이트 로그인만으로 개인 상점 접근 권한이 부여되지 않습니다. VP 가격도 아직 조회할 수 없습니다."
            textSize = 13f
            setTextColor(Color.rgb(142, 44, 36))
            setPadding(0, dp(8), 0, dp(8))
        })
        val tabs = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        tabs.addView(Button(this).apply {
            text = "전체 도감"
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
            setOnClickListener { pickedOnly = false; render() }
        })
        tabs.addView(Button(this).apply {
            text = "내 수동 목록"
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
            setOnClickListener { pickedOnly = true; render() }
        })
        root.addView(tabs)
        searchBox = EditText(this).apply {
            hint = "스킨 이름 검색"
            setSingleLine(true)
            textSize = 14f
        }
        root.addView(searchBox)
        searchBox.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) { render() }
            override fun afterTextChanged(s: Editable?) {}
        })
        status = TextView(this).apply { text = "공개 스킨 정보 로딩 중..." }
        root.addView(status)
        resultArea = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        root.addView(ScrollView(this).apply { addView(resultArea) },
            LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        fetchSkins()
    }

    private fun fetchSkins() {
        executor.execute {
            try {
                val conn = URL("https://valorant-api.com/v1/weapons/skins?language=ko-KR")
                    .openConnection() as HttpsURLConnection
                conn.connectTimeout = 15000
                conn.readTimeout = 20000
                conn.instanceFollowRedirects = false
                val parsed = try {
                    if (conn.responseCode != 200) error("HTTP " + conn.responseCode)
                    val json = conn.inputStream.bufferedReader().use { it.readText() }
                    val data = JSONObject(json).getJSONArray("data")
                    buildList {
                        for (i in 0 until data.length()) {
                            val item = data.optJSONObject(i) ?: continue
                            val id = item.optString("uuid")
                            val name = item.optString("displayName")
                            if (id.isBlank() || name.isBlank()) continue
                            val icon = item.optString("displayIcon").ifBlank {
                                item.optJSONArray("chromas")?.optJSONObject(0)
                                    ?.optString("displayIcon") ?: ""
                            }
                            add(Skin(id, name, icon.takeIf { it.isNotBlank() }))
                        }
                    }.sortedBy { it.name.lowercase(Locale.ROOT) }
                } finally { conn.disconnect() }
                runOnUiThread {
                    if (!isFinishing && !isDestroyed) {
                        skins = parsed
                        render()
                    }
                }
            } catch (e: Exception) {
                runOnUiThread {
                    if (!isFinishing && !isDestroyed) {
                        status.text = "공개 스킨 정보 요청 실패: " + e.javaClass.simpleName
                    }
                }
            }
        }
    }

    private fun render() {
        if (!::resultArea.isInitialized || !::searchBox.isInitialized || !::status.isInitialized) return
        val marker = ++renderId
        resultArea.removeAllViews()
        if (skins.isEmpty()) return
        val query = searchBox.text.toString().trim()
        val matching = skins.filter {
            (!pickedOnly || picked.contains(it.id)) &&
                (query.isEmpty() || it.name.contains(query, ignoreCase = true))
        }
        status.text = if (pickedOnly) "수동 선택: " + picked.size + "개 · 실제 상점 데이터 아님"
            else "공개 스킨 " + skins.size + "개 / 검색 " + matching.size + "개 (상위 20개 표시)"
        if (matching.isEmpty()) {
            resultArea.addView(TextView(this).apply { text = "검색 결과 없음" })
            return
        }
        for (skin in matching.take(20)) {
            val row = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                setPadding(0, dp(6), 0, dp(6))
            }
            val imageView = ImageView(this).apply {
                scaleType = ImageView.ScaleType.FIT_CENTER
                setBackgroundColor(Color.rgb(238, 239, 244))
            }
            row.addView(imageView, LinearLayout.LayoutParams(dp(62), dp(55)))
            row.addView(TextView(this).apply {
                text = skin.name + "\nVP 가격: 개인 상점 미연동"
                textSize = 12f
                setPadding(dp(5), 0, 0, 0)
            }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
            row.addView(Button(this).apply {
                text = if (picked.contains(skin.id)) "제거" else "담기"
                textSize = 11f
                setOnClickListener {
                    if (!picked.add(skin.id)) picked.remove(skin.id)
                    getSharedPreferences("skin_selection", MODE_PRIVATE).edit()
                        .putStringSet("selected", picked.toSet()).apply()
                    render()
                }
            }, LinearLayout.LayoutParams(dp(68), ViewGroup.LayoutParams.WRAP_CONTENT))
            resultArea.addView(row)
            val image = skin.icon ?: continue
            if (allowedImage(image)) {
                executor.execute {
                    try {
                        val conn = URL(image).openConnection() as HttpsURLConnection
                        conn.connectTimeout = 8000
                        conn.readTimeout = 10000
                        conn.instanceFollowRedirects = false
                        try {
                            if (conn.responseCode == 200) {
                                val bitmap = conn.inputStream.use { BitmapFactory.decodeStream(it) }
                                if (bitmap != null) runOnUiThread {
                                    if (!isFinishing && !isDestroyed && marker == renderId)
                                        imageView.setImageBitmap(bitmap)
                                }
                            }
                        } finally { conn.disconnect() }
                    } catch (_: Exception) { /* Public artwork may be unavailable. */ }
                }
            }
        }
    }

    private fun allowedImage(raw: String): Boolean = try {
        val url = URL(raw)
        url.protocol == "https" && url.host.equals("media.valorant-api.com", ignoreCase = true)
    } catch (_: Exception) { false }

    private fun dp(n: Int): Int = (n * resources.displayMetrics.density).toInt()

    override fun onDestroy() {
        executor.shutdownNow()
        super.onDestroy()
    }
}
