/*{
    "DESCRIPTION": "MadMapper-style GENERATORS demo: a time_base generator drives mat_time_source while the viewer computes it on the CPU and feeds it as a uniform.",
    "CREDIT": "docsify-isf self-test",
    "ISFVSN": "2",
    "CATEGORIES": [
        "docsify-isf",
        "Test"
    ],
    "INPUTS": [
        {
            "NAME": "mat_speed",
            "TYPE": "float",
            "LABEL": "Speed",
            "DEFAULT": 1.0,
            "MIN": 0.0,
            "MAX": 4.0
        },
        {
            "NAME": "mat_reverse",
            "TYPE": "bool",
            "LABEL": "Reverse",
            "DEFAULT": false
        }
    ],
    "GENERATORS": [
        {
            "NAME": "mat_time_source",
            "TYPE": "time_base",
            "PARAMS": {
                "speed": "mat_speed",
                "reverse": "mat_reverse"
            }
        }
    ]
}*/

void main()
{
    float t = mat_time_source;
    vec2 uv = isf_FragNormCoord;
    vec3 color = 0.5 + 0.5 * cos(6.28318 * (uv.xyx * 3.0 + t * 0.35 + vec3(0.0, 0.33, 0.66)));
    float rings = 0.5 + 0.5 * sin(length(uv - 0.5) * 30.0 - t * 2.0);
    gl_FragColor = vec4(color * (0.5 + 0.5 * rings), 1.0);
}
