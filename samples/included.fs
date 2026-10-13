/*{
    "DESCRIPTION": "Demonstrates #include resolution: included-helper.glsl is fetched relative to this file and inlined before translation (missing includes are reported in the status bar).",
    "CREDIT": "docsify-isf self-test",
    "ISFVSN": "2",
    "CATEGORIES": [
        "docsify-isf",
        "Test"
    ],
    "INPUTS": [
        {
            "NAME": "speed",
            "TYPE": "float",
            "LABEL": "Speed",
            "DEFAULT": 0.35,
            "MIN": 0.0,
            "MAX": 2.0
        }
    ]
}*/

#include "included-helper.glsl"

void main()
{
    vec2 uv = isf_FragNormCoord;
    float t = uv.x + uv.y + TIME * speed;
    vec3 color = isfHelperPalette(t) * (0.6 + 0.4 * isfHelperPulse(TIME * speed));
    gl_FragColor = vec4(color, 1.0);
}
