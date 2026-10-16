using System;

namespace Company.WebView.Unified.Experimental
{
    /// <summary>
    /// Pure geometry only. Converts Unity lower-left UV into browser upper-left
    /// pixel coordinates, after applying the visual surface's UV transform.
    /// Does NOT inject native mouse events; a future input backend owns that.
    /// </summary>
    public static class WebViewInputCoordinates
    {
        public static bool TryFromUV(float u, float v, int browserWidth, int browserHeight,
            float scaleU, float scaleV, float offsetU, float offsetV,
            out int pixelX, out int pixelY)
        {
            pixelX=0;pixelY=0;
            if(browserWidth<=0 || browserHeight<=0 ||
               float.IsNaN(u) || float.IsNaN(v) ||
               float.IsNaN(scaleU) || float.IsNaN(scaleV) ||
               float.IsNaN(offsetU) || float.IsNaN(offsetV) ||
               float.IsInfinity(u) || float.IsInfinity(v) ||
               float.IsInfinity(scaleU) || float.IsInfinity(scaleV) ||
               float.IsInfinity(offsetU) || float.IsInfinity(offsetV))
                return false;

            double x=(double)u*scaleU+offsetU;
            double y=(double)v*scaleV+offsetV;
            if(x<0 || x>1 || y<0 || y>1) return false;
            pixelX=Math.Min(browserWidth-1,(int)(x*browserWidth));
            pixelY=Math.Min(browserHeight-1,(int)((1-y)*browserHeight));
            return true;
        }

        /// <summary>
        /// Convert bottom-left local RectTransform-like coordinates to pixel coords.
        /// Caller must first resolve world/Canvas/screen coordinates into this local
        /// rectangle, including aspect fit/crop and raycast target selection.
        /// </summary>
        public static bool TryFromLocalRect(float localX, float localY,
            float rectWidth, float rectHeight, int browserWidth, int browserHeight,
            float scaleU, float scaleV, float offsetU, float offsetV,
            out int pixelX, out int pixelY)
        {
            pixelX=0;pixelY=0;
            if(rectWidth<=0 || rectHeight<=0 ||
                float.IsNaN(localX) || float.IsNaN(localY) ||
                float.IsInfinity(localX) || float.IsInfinity(localY) ||
                float.IsNaN(rectWidth) || float.IsNaN(rectHeight) ||
                float.IsInfinity(rectWidth) || float.IsInfinity(rectHeight))
                return false;
            return TryFromUV(localX/rectWidth,localY/rectHeight,
                browserWidth,browserHeight,scaleU,scaleV,offsetU,offsetV,
                out pixelX,out pixelY);
        }
    }
}
