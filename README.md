# Gestao-Im-vel-Certo
O objetivo da planilha é listar as demandas de locação acima de R$8000,00 passar para as captadoras em Roleta para que elas possam buscar o imóvel para esse cliente em no máximo 48hrs, medir o tempo que as captadoras levam para encontrar o imóvel, monitorar quanto tempo elas levam para avançar cada etapa da captação


 if (row.count === 0) {
            console.log("Criando usuários padrão...");
            
            const senhaHash = await bcrypt.hash('Adim2025', 10);
            
            // Usuário admin
            db.run(`INSERT INTO usuarios (nome, email, senha, tipo, regiao) VALUES (?, ?, ?, ?, ?)`, 
                   ['Administrador', 'admin@imovelcerto.com', senhaHash, 'admin', 'Geral']);
            
            // Gerente regional de Itapema
            db.run(`INSERT INTO usuarios (nome, email, senha, tipo, regiao) VALUES (?, ?, ?, ?, ?)`, 
                   ['Gerente Itapema', 'pedro@adimimoveis.com.br', senhaHash, 'gerente_regional', 'Itapema']);
            
            // Gerente de Balneário Camboriú e Itajaí (Lidiane)
            db.run(`INSERT INTO usuarios (nome, email, senha, tipo, regiao, regioes_responsavel) VALUES (?, ?, ?, ?, ?, ?)`, 
                   ['Lidiane Silva', 'lidiane@adimimoveis.com.br', senhaHash, 'gerente_regional', 'Balneario_Camboriu', 'Balneario_Camboriu,Itajai']);
            
            // Usuários captadores de Itapema
            const captadoresItapema = [
                ['Jenifer de Souza', 'jenifer@adimimoveis.com.br', 'Itapema'],
            ];
            
            // Captadores de Balneário Camboriú e Itajaí
            const captadoresBC = [
                ['Michele Oliveira', 'michele@adimimoveis.com.br', 'Balneario_Camboriu'],
                ['Morgana Barreto', 'mrogana@adimimoveis.com.br', 'Balneario_Camboriu'],
                ['Bruna Spinello', 'brunaspinello@crimoveis.com.br', 'Balneario_Camboriu'],
                ['Michele Oliveira', 'michele@adimimoveis.com.br', 'Itajai'],
                ['Morgana Barreto', 'mrogana@adimimoveis.com.br', 'Itajai'],
                ['Bruna Spinello', 'brunaspinello@crimoveis.com.br', 'Itajai'],
            ];
            
            [...captadoresItapema, ...captadoresBC, ...captadorGeral].forEach(captador => {
                db.run(`INSERT INTO usuarios (nome, email, senha, tipo, regiao) VALUES (?, ?, ?, ?, ?)`, 
                       [captador[0], captador[1], senhaHash, 'captador', captador[2]]);
            });