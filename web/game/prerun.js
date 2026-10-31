// Executa antes do main(): baixa os .o2r (se existirem) para o sistema de arquivos virtual do jogo.
// Em produção o mk64.o2r vem do Torch (a partir da ROM do usuário); aqui serve para testes.
Module.preRun = Module.preRun || [];
Module.preRun.push(function () {
  const names = (Module.mk64Files || ['spaghetti.o2r', 'mk64.o2r']);
  names.forEach(function (name) {
    addRunDependency('fetch-' + name);
    fetch(name).then(function (r) { return r.ok ? r.arrayBuffer() : null; }).then(function (buf) {
      if (buf) { FS.writeFile('/' + name, new Uint8Array(buf)); console.log('[prerun] ' + name + ' ' + buf.byteLength + ' bytes'); }
      else console.warn('[prerun] ' + name + ' não encontrado');
      removeRunDependency('fetch-' + name);
    }).catch(function () { removeRunDependency('fetch-' + name); });
  });
});
