"""Local review server; serves assets plus an existing Three.js installation."""
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
import argparse
parser=argparse.ArgumentParser();parser.add_argument('--three',required=True);parser.add_argument('--port',type=int,default=8766);args=parser.parse_args()
root=Path(__file__).resolve().parent;vendor=Path(args.three).resolve()
class Handler(SimpleHTTPRequestHandler):
    def translate_path(self,path):
        path=path.split('?')[0]
        base=vendor if path.startswith('/vendor/') else root
        suffix=path[len('/vendor/'):] if path.startswith('/vendor/') else path.lstrip('/')
        candidate=(base/suffix).resolve()
        return str(candidate if candidate.is_relative_to(base) else base/'__invalid__')
ThreadingHTTPServer(('127.0.0.1',args.port),Handler).serve_forever()
