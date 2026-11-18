# Assemble index.html : src.html + les morceaux embarqués en base64 (aucun téléchargement à l'exécution)
import base64,re,os
d=os.path.dirname(os.path.abspath(__file__));s=open(os.path.join(d,'src.html'),encoding='utf-8').read()
files=re.findall(r"file:'([^']+)'",s)
data=','.join('"'+base64.b64encode(open(os.path.join(d,f),'rb').read()).decode()+'"' for f in files)
s=s.replace('<!--TRACKS-->','<script>window.NP_TRACKS=['+data+']</script>')
open(os.path.join(d,'index.html'),'w',encoding='utf-8').write(s);print('index.html',len(s)//1024,'Ko',files)
