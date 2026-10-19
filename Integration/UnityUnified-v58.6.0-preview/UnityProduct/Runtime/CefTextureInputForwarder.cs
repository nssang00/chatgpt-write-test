using System;
using System.Text;
using Company.WebView;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;

namespace Company.WebView.Unified.Experimental
{
    // Opt-in CEF OSR pointer/keyboard forwarding for the pinned single-host native DLL.
    // Requires a RawImage raycastTarget, EventSystem + StandaloneInputModule and legacy Input.
    // No Editor Play mode support, no native DLL changes, and no claims of certified IME.
    [DisallowMultipleComponent]
    [AddComponentMenu("Company WebView/CEF Texture Input Forwarder (Preview)")]
    public sealed class CefTextureInputForwarder : MonoBehaviour,
        IPointerDownHandler, IPointerUpHandler, IScrollHandler, IDragHandler,
        IPointerEnterHandler, IPointerExitHandler
    {
        [SerializeField] private UnifiedWebViewPanel owner;
        [SerializeField] private RawImage target;
        [SerializeField] private bool forwardKeyboard = true;

        private bool focused, inside, lastMouseValid;
        private int mouseX, mouseY;
        private string lastComposition = "";
        private readonly StringBuilder imeCommit = new StringBuilder(32);

        private bool Ready => owner != null && owner.CanForwardTextureInput && target != null;

        private bool Locate(Vector2 point, Camera camera, out int x, out int y)
        {
            x = y = 0;
            if (target == null || owner == null) return false;
            Vector2 local;
            if (!RectTransformUtility.ScreenPointToLocalPointInRectangle(
                target.rectTransform, point, camera, out local)) return false;
            var rect = target.rectTransform.rect;
            if (rect.width <= 0 || rect.height <= 0) return false;
            float u = (local.x - rect.xMin) / rect.width;
            float v = (local.y - rect.yMin) / rect.height;
            if (u < 0f || u > 1f || v < 0f || v > 1f) return false;
            x = Mathf.Clamp(Mathf.FloorToInt(u * owner.BrowserWidth), 0, owner.BrowserWidth - 1);
            // Browser coordinates are top-left-origin. The prefab's uvRect flips V.
            y = Mathf.Clamp(Mathf.FloorToInt((1f - v) * owner.BrowserHeight), 0, owner.BrowserHeight - 1);
            return true;
        }

        private bool Point(Vector2 point, Camera camera, bool leaveIfOutside)
        {
            int x, y;
            if (!Locate(point, camera, out x, out y))
            {
                if (leaveIfOutside && lastMouseValid && Ready)
                    WebViewRuntime.CefPrototype_InteractionMouseMove(mouseX, mouseY, 1);
                lastMouseValid = false;
                return false;
            }
            if (Ready && (!lastMouseValid || mouseX != x || mouseY != y))
                WebViewRuntime.CefPrototype_InteractionMouseMove(x, y, 0);
            mouseX = x;
            mouseY = y;
            lastMouseValid = true;
            return true;
        }

        public void OnPointerEnter(PointerEventData eventData)
        {
            if (!Ready) return;
            inside = true;
            Point(eventData.position, eventData.enterEventCamera, false);
        }
        public void OnPointerExit(PointerEventData eventData)
        {
            if (!Ready) return;
            inside = false;
            Point(eventData.position, eventData.enterEventCamera, true);
        }
        public void OnDrag(PointerEventData eventData)
        {
            if (Ready) Point(eventData.position, eventData.pressEventCamera, true);
        }
        public void OnPointerDown(PointerEventData eventData)
        {
            if (!Ready || !Point(eventData.position, eventData.pressEventCamera, false)) return;
            focused = true;
            WebViewRuntime.CefPrototype_InteractionSetFocus(1);
            WebViewRuntime.CefPrototype_InteractionMouseClick(mouseX, mouseY,
                MapButton(eventData.button), 0, Math.Max(1, eventData.clickCount));
        }
        public void OnPointerUp(PointerEventData eventData)
        {
            if (!Ready) return;
            // A release outside the rect must still balance a prior button-down.
            Point(eventData.position, eventData.pressEventCamera, true);
            WebViewRuntime.CefPrototype_InteractionMouseClick(mouseX, mouseY,
                MapButton(eventData.button), 1, Math.Max(1, eventData.clickCount));
        }
        public void OnScroll(PointerEventData eventData)
        {
            if (!Ready || !Point(eventData.position, eventData.enterEventCamera, false)) return;
            WebViewRuntime.CefPrototype_InteractionMouseWheel(mouseX, mouseY,
                Mathf.RoundToInt(eventData.scrollDelta.x * 120f),
                Mathf.RoundToInt(eventData.scrollDelta.y * 120f));
        }
        private static int MapButton(PointerEventData.InputButton b)
        {
            return b == PointerEventData.InputButton.Middle ? 1 :
                b == PointerEventData.InputButton.Right ? 2 : 0;
        }

        private void Update()
        {
#if UNITY_STANDALONE_WIN && !UNITY_EDITOR
            if (!Ready) return;
            if (inside) Point(Input.mousePosition, null, true);
            // Clicking elsewhere releases keyboard focus to the Unity UI/Overlay.
            if (focused && Input.GetMouseButtonDown(0) && !Point(Input.mousePosition, null, false))
                SetFocused(false);
            if (focused && forwardKeyboard) Keyboard();
#endif
        }
        private void Keyboard()
        {
            // Match the existing validated real-input harness: Input.inputString commits,
            // CEF raw key events for navigation, and provisional composition forwarding.
            SendKey(KeyCode.Backspace, 8);
            SendKey(KeyCode.Return, 13);
            SendKey(KeyCode.KeypadEnter, 13);
            SendKey(KeyCode.Tab, 9);
            SendKey(KeyCode.Delete, 46);
            SendKey(KeyCode.LeftArrow, 37);
            SendKey(KeyCode.UpArrow, 38);
            SendKey(KeyCode.RightArrow, 39);
            SendKey(KeyCode.DownArrow, 40);
            SendKey(KeyCode.Home, 36);
            SendKey(KeyCode.End, 35);
            SendKey(KeyCode.Escape, 27);

            var composition = Input.compositionString ?? "";
            var committed = Input.inputString ?? "";
            if (!String.Equals(composition, lastComposition, StringComparison.Ordinal))
            {
                if (composition.Length != 0) WebViewRuntime.CefPrototype_InteractionImeSetComposition(composition);
                else if (lastComposition.Length != 0 && committed.Length == 0)
                    WebViewRuntime.CefPrototype_InteractionImeFinish();
                lastComposition = composition;
            }
            if (committed.Length == 0) return;
            imeCommit.Length = 0;
            foreach (char ch in committed)
            {
                if (ch == '\b' || ch == '\n' || ch == '\r' || ch == '\t') continue;
                if (ch >= 0x80) imeCommit.Append(ch);
                else if (!char.IsControl(ch))
                {
                    int vk = Char.ToUpperInvariant(ch);
                    WebViewRuntime.CefPrototype_InteractionSendKey(vk, 0);
                    WebViewRuntime.CefPrototype_InteractionSendChar(ch);
                    WebViewRuntime.CefPrototype_InteractionSendKey(vk, 1);
                }
            }
            if (imeCommit.Length != 0)
            {
                WebViewRuntime.CefPrototype_InteractionImeCommitText(imeCommit.ToString());
                lastComposition = "";
            }
        }
        private static void SendKey(KeyCode unityCode, int windowsCode)
        {
            if (Input.GetKeyDown(unityCode)) WebViewRuntime.CefPrototype_InteractionSendKey(windowsCode, 0);
            if (Input.GetKeyUp(unityCode)) WebViewRuntime.CefPrototype_InteractionSendKey(windowsCode, 1);
        }
        private void SetFocused(bool next)
        {
            if (focused == next) return;
            focused = next;
            if (Ready) WebViewRuntime.CefPrototype_InteractionSetFocus(next ? 1 : 0);
            if (!next) lastComposition = "";
        }
        private void OnApplicationFocus(bool appFocused) { if (!appFocused) SetFocused(false); }
        private void OnDisable()
        {
            SetFocused(false);
            inside = false;
            lastMouseValid = false;
        }
    }
}

