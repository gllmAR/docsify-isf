/*{
    "DESCRIPTION": "Deliberately malformed metadata to self-test header error reporting (the trailing comma inside the INPUTS array is fine, the bare word is not).",
    "CREDIT": "docsify-isf self-test",
    "ISFVSN": "2",
    "INPUTS": [
        broken
    ]
}*/

void main()
{
    gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0);
}
