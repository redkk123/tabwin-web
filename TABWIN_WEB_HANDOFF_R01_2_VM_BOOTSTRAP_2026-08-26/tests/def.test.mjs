import assert from 'node:assert/strict';
import test from 'node:test';
import { optionsForRole, parseDef } from '../dist/packages/formats/src/index.js';

const historicalExample = `; Autorização de Internação Hospitalar
Ac:\\tabwin\\RD*.DBF
LCID Capítulos,CID,1,CAUSCAPB.CNV
LHospital,CGC_HOSP,NOME_HOSP,HOSPITAL.DBF
SHospital,CGC_HOSP,NOME_HOSP,HOSPITAL.DBF
LGrupo Proced,PRCD,1,GRUPOPRC.CNV
LMunicípio,MU_IBGE_LO,1,MUNICIPIO.CNV
SMunicípio,MU_IBGE_LO,1,MUNICIPIO.CNV
LNatureza,NATUREZA,1,NATUREZA.CNV
LEspecialidade,ESPECIALID,1,ESPECIAL.CNV
CEspecialidade,ESPECIALID,1,ESPECIAL.CNV
CSexo,SEXO,1,SEXOAIH.CNV
CFaixa Etária (5),COD_IDADE,1,IDADEBAS.CNV
IValor Total,VALOR_TOT
IPermanência,PERMANEN`;

test('parses documented DEF axis, DBF lookup and increment directives', () => {
  const def = parseDef(historicalExample);
  assert.equal(def.description, 'Autorização de Internação Hospitalar');
  assert.equal(def.dataSources[0]?.pattern, 'c:\\tabwin\\RD*.DBF');
  assert.equal(def.options.length, 11);
  assert.equal(def.increments.length, 2);

  const cid = def.options[0];
  assert.equal(cid?.kind, 'conversion');
  assert.equal(cid?.startPosition, 1);
  assert.equal(cid?.conversionFile, 'CAUSCAPB.CNV');

  const hospital = def.options[1];
  assert.equal(hospital?.kind, 'dbf-lookup');
  assert.equal(hospital?.lookupLabelField, 'NOME_HOSP');
  assert.equal(hospital?.lookupFile, 'HOSPITAL.DBF');
});

test('D and T directives expand to their documented roles', () => {
  const def = parseDef(`; roles\nA*.DBF\nDRegião,UF,1,UF.CNV\nTSexo,SEXO,1,SEXO.CNV`);
  assert.deepEqual(optionsForRole(def, 'row').map((x) => x.label), ['Região', 'Sexo']);
  assert.deepEqual(optionsForRole(def, 'column').map((x) => x.label), ['Sexo']);
  assert.deepEqual(optionsForRole(def, 'quad').map((x) => x.label), ['Região', 'Sexo']);
});

test('parses A optional SQL query introduced in TabWin 3.x', () => {
  const def = parseDef(`; sql\nA\\dados\\meudbf*.db?,\\dados\\gerameudbf.sql\nLRegião,UF,1,UF.CNV`);
  assert.equal(def.dataSources[0]?.pattern, '\\dados\\meudbf*.db?');
  assert.equal(def.dataSources[0]?.sqlQuery, '\\dados\\gerameudbf.sql');
});

test('parses grouped-frequency G and retains legacy R', () => {
  const def = parseDef(`; grouped\nA*.DBF\nGQUANTIDADE\nRsaida.rel\nLRegião,UF,1,UF.CNV`);
  assert.equal(def.groupedCountField, 'QUANTIDADE');
  assert.equal(def.reportFile, 'saida.rel');
});

test('does not guess X directive semantics', () => {
  const def = parseDef(`; x\nA*.DBF\nXAlguma coisa,CAMPO,1,X.CNV\nLRegião,UF,1,UF.CNV`);
  assert.equal(def.unknownLines[0]?.directive, 'X');
  assert.match(def.warnings.join('\n'), /X directive detected/);
});

test('retains contemporary textual-field CNV lookups without pretending they are DBF lookups', () => {
  const def = parseDef(`; contemporary\nA*.DBC\nLSubTp FAEC,FAEC_TP,DS_TPFIN,CNV\\TP_FINAN.CNV`);
  const option = def.options[0];
  assert.equal(option?.kind, 'external-lookup');
  assert.equal(option?.lookupLabelField, 'DS_TPFIN');
  assert.equal(option?.resourceFile, 'CNV\\TP_FINAN.CNV');
});
