from http.server import SimpleHTTPRequestHandler, HTTPServer

PORT = 8000

class CORSRequestHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        super().end_headers()

httpd = HTTPServer(("0.0.0.0", PORT), CORSRequestHandler)
print(f"Serving at http://localhost:{PORT}")
httpd.serve_forever()
