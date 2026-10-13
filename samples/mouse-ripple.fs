/* ---------------------------------------------------------------------
   This file was produced by the docsify-isf Shadertoy importer: paste a
   mainImage() shader into the viewer's Import panel and press
   "Convert & Load". iMouse is the docsify-isf pointer extension, so
   moving/clicking over the preview moves the ripple.
   --------------------------------------------------------------------- */
/*{
    "DESCRIPTION": "Converted from a Shadertoy mainImage() shader.",
    "CREDIT": "Converted to ISF by docsify-isf",
    "ISFVSN": "2",
    "CATEGORIES": [ "Converted" ],
    "INPUTS": [

    ]
}*/
#define HW_PERFORMANCE 1
#define iMouse _isfMouse

void mainImage(out vec4 fragColor, in vec2 fragCoord)
{
    vec2 uv = (2.0 * fragCoord - RENDERSIZE.xy) / RENDERSIZE.y;
    vec2 m = (2.0 * iMouse.xy - RENDERSIZE.xy) / RENDERSIZE.y;
    float d = length(uv - m);
    float ring = 0.5 + 0.5 * sin(20.0 * d - 4.0 * TIME);
    vec3 col = 0.5 + 0.5 * cos(6.28318 * (ring + vec3(0.0, 0.33, 0.66)));
    fragColor = vec4(col * (1.0 + 0.6 * sin(d * 3.0 - TIME * 2.0)), 1.0);
}

void main() {
    mainImage(gl_FragColor, gl_FragCoord.xy);
}
