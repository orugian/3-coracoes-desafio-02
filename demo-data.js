/* Dados do modo demo (docs/specs/05-integracao-web.md, "Arquivos"): catálogo com os valores da Order Basis (ob),
   clientes com listas, fatores e bloqueios, e os 3 pedidos de exemplo. Abre por file:// ou pelo GitHub Pages.
   O servidor nunca serve este arquivo: em /demo-data.js ele responde "window.PSF_DEMO = null;" (modo servidor). */
(function(){
// Peso/volume por caixa: Conferência de produtos (SAP). Cx/pallet: lastro x altura (Materiais, SAP).
// Preço: Registros (lista US / EXP-MINOIL); quando ausente, preço manual da Order Basis.
const P = [
 {code:"12031189",fam:"CAFES",brand:"3corações",sap:"CAFE TM 3C TRAD EXP VAC 20X250G",pt:"Café Tradicional a vácuo 250 g",es:"Café Tradicional al vacío 250 g",un:20,unLbl:"20 × 250 g",net:5.0,gross:5.33,dm3:13.276,lastro:14,alt:12,price:49.41,priceSrc:"sap",loteMin:1,shelf:547,ncm:"0901.21.00",dims:"426×196×159",
  ob:{cxPal:168,palz:168,price:49.41,lote:1,grossCx:5.18}},
 {code:"12031291",fam:"CAFES",brand:"3corações",sap:"CAFE TM 3C EST R PREM AL VAC 20X250G",pt:"Café Estrada Real Premium a vácuo 250 g",es:"Café Premium Estrada Real al vacío 250 g",un:20,unLbl:"20 × 250 g",net:5.0,gross:5.33,dm3:13.276,lastro:14,alt:12,price:60.17,priceSrc:"sap",loteMin:1,shelf:547,ncm:"0901.21.00",dims:"426×196×159",
  ob:{cxPal:168,palz:168,price:60.17,lote:1,grossCx:5.34}},
 {code:"12034103",fam:"CAPPUCCINO",brand:"3corações",sap:"CAFE CAPP 3C CLAS AL SACHE 16X10X20G",pt:"Cappuccino Clássico sachê 20 g",es:"Cappuccino Clásico sachet 20 g",un:160,unLbl:"16 × 10 × 20 g",net:3.2,gross:4.15,dm3:17.159,lastro:9,alt:9,price:24.75,priceSrc:"sap",loteMin:1,shelf:365,ncm:"2101.12.00",dims:"414×264×157",
  ob:{cxPal:81,palz:9,price:24.75,lote:1,grossCx:3.84}},
 {code:"12034109",fam:"CAPPUCCINO",brand:"3corações",sap:"CAFE CAPP 3C BAUN ABRA COR AL PT 24X200G",pt:"Cappuccino Baunilha pote 200 g",es:"Cappuccino Vainilla pote 200 g",un:24,unLbl:"24 × 200 g",net:4.8,gross:6.177,dm3:21.279,lastro:4,alt:7,price:36.96,priceSrc:"manual",loteMin:1,shelf:365,ncm:"2101.12.00",dims:"346×246×250",
  ob:{cxPal:98,palz:98,price:36.96,lote:1,grossCx:6.17}},
 {code:"12037417",fam:"FILTROS",brand:"3corações",sap:"FILTRO PAP 3C 102/30 RED DES 40X30UN",pt:"Filtro de papel 102 com 30",es:"Filtro de papel #102 x 30",un:40,unLbl:"40 × 30 un",net:1.56,gross:2.34,dm3:18.743,lastro:13,alt:7,price:29.48,priceSrc:"manual",loteMin:2,shelf:1095,ncm:"4823.20.99",dims:"350×210×255",
  ob:{cxPal:91,palz:68.25,price:29.48,lote:1,grossCx:1.36}},
 {code:"12142146",fam:"SOLUVEIS",brand:"Iguaçu",sap:"CAFE SOL IGUA CLAS AL VID 12X160G",pt:"Solúvel Clássico vidro 160 g",es:"Soluble Clásico frasco 160 g",un:12,unLbl:"12 × 160 g",net:1.92,gross:6.886,dm3:16.03,lastro:12,alt:10,price:50.27,priceSrc:"sap",loteMin:5,shelf:1095,ncm:"2101.11.10",dims:"330×276×176",
  ob:{cxPal:120,palz:120,price:50.01,lote:5,grossCx:6.79}},
 {code:"12142501",fam:"SOLUVEIS",brand:"Iguaçu",sap:"CAFE SOL IGUA PO TRAD REF 24X40G",pt:"Solúvel Tradicional refil 40 g",es:"Soluble Tradicional repuesto 40 g",un:24,unLbl:"24 × 40 g",net:0.96,gross:1.38,dm3:7.056,lastro:20,alt:14,price:21.56,priceSrc:"sap",loteMin:5,shelf:730,ncm:"2101.11.10",dims:"360×140×140",
  ob:{cxPal:280,palz:240,price:21.56,lote:5,grossCx:1.37}},
 {code:"12144012",fam:"CAPPUCCINO",brand:"Iguaçu",sap:"CAFE CAPP IGUA CLAS SCH 8X10X10G",pt:"Cappuccino Clássico sachê 10 g",es:"Cappuccino Clásico sachet 10 g",un:80,unLbl:"8 × 10 × 10 g",net:0.8,gross:1.3,dm3:7.373,lastro:19,alt:11,price:9.68,priceSrc:"sap",loteMin:1,shelf:365,ncm:"2101.12.00",dims:"518×105×145",
  ob:{cxPal:209,palz:20.9,price:9.68,lote:3.12,grossCx:1.28}},
 {code:"12147801",fam:"SOLUVEIS",brand:"Iguaçu",sap:"CAFE SOL IGUA TRAD STICK 24X10X1,7G",pt:"Solúvel Tradicional stick 1,7 g",es:"Soluble Tradicional stick 1,7 g",un:240,unLbl:"24 × 10 × 1,7 g",net:0.408,gross:1.2,dm3:8.67,lastro:15,alt:12,price:19.71,priceSrc:"sap",loteMin:1,shelf:730,ncm:"2101.11.10",dims:"340×198×127",
  ob:{cxPal:180,palz:180,price:19.71,lote:1,grossCx:11.52}},
 {code:"20908885",fam:"PORTA",brand:"3corações",sap:"PORTA FILTRO 3C PLAST VM 102 C/12",pt:"Porta filtro plástico 102",es:"Porta filtro plástico #102",un:12,unLbl:"12 un",net:0.552,gross:1.24,dm3:25.35,lastro:11,alt:10,price:17.61,priceSrc:"manual",loteMin:1,shelf:9999,ncm:"3924.10.00",dims:"390×260×250",
  ob:{cxPal:60,palz:77,price:17.61,lote:1,grossCx:0.90}}
];
const EXTRA={"12031189": {"en": "Traditional Coffee, vacuum pack 250 g", "ean": "7896005800362", "dun": "17896005800369", "linha": "01.CAFES TRAD/EF"}, "12031291": {"en": "Estrada Real Premium Coffee, vacuum pack 250 g", "ean": "7896005802557", "dun": "37896005802558", "linha": "07.CAFES PREMIUM"}, "12034103": {"en": "Classic Cappuccino sachet 20 g", "ean": "7896005802373", "dun": "27896005802629", "linha": "03.CAPP - MONODOSE"}, "12034109": {"en": "Vanilla Cappuccino jar 200 g", "ean": "7896005804629", "dun": "37896005804620", "linha": "01.CAPP - POTE"}, "12037417": {"en": "Paper filter 102, pack of 30", "ean": "7896005803714", "dun": "17896005803711", "linha": "01.FILTROS"}, "12142146": {"en": "Classic Instant Coffee, glass jar 160 g", "ean": "7896045120949", "dun": "27896045120943", "linha": "02.SOL - VIDRO"}, "12142501": {"en": "Traditional Instant Coffee refill 40 g", "ean": "7896045102990", "dun": "17896045102997", "linha": "01.SOL - REFIL"}, "12144012": {"en": "Classic Cappuccino sachet 10 g", "ean": "7896045104390", "dun": "17896045105691", "linha": "03.CAPP - MONODOSE"}, "12147801": {"en": "Traditional Instant Coffee stick 1.7 g", "ean": "7896045102167", "dun": "17896045102164", "linha": "01.SOL - REFIL"}, "20908885": {"en": "Plastic filter holder 102", "ean": "7896005804247", "dun": "17896005804244", "linha": "01.PORTA FILTROS"}};
P.forEach(p=>Object.assign(p,EXTRA[p.code]||{}));

const CLIENTS = {
  minoil:{name:"MINOIL S.A.",code:"11131",dest:"Mercosul",cur:"USD",inc:"FCA",pay:"Standby irrevogável 60 dias",payCode:"2304",list:"US",factor:1,blocked:[],filial:"CD Londrina (2612)",contact:"Martín",mixed:false,autoApprove:false},
  rioclaro:{name:"Distribuidora Río Claro S.R.L.",code:"11999",dest:"Argentina",cur:"USD",inc:"FCA",pay:"Antecipado 30 dias",payCode:"0030",list:"AR",factor:1.06,blocked:["20908885"],filial:"CD Londrina (2612)",contact:"Sofía",lang:"es",mixed:false,autoApprove:false}
};

/* Pedidos de exemplo (o seed do piloto) */
const ORDERS = [
  {id:"3CC-2026-0001",client:"minoil",veh:"carreta",mode:"pal",mixed:false,qty:{"12031189":3528,"12034103":300,"12037417":250,"12144012":300},ref:"PEDIDO TESTE",date:"",status:"analise",created:"09/10 17:53",createdMs:new Date(2026,9,9,17,53).getTime(),origin:"Order Basis",
  audit:[{at:"09/10 17:53",who:"Lucas (Exportação)",what:"Pedido importado da planilha Order Basis para comparação. A planilha indicava embarque OK."},{at:"09/10 17:54",who:"Motor de validação",what:"30 pallets para 28 posições na carreta: excesso de 2 posições."}]},
  {id:"3CC-2026-0002",client:"minoil",veh:"carreta",mode:"pal",mixed:false,v:4,qty:{"12031189":2688,"12034103":405,"12142146":600,"12037417":182},ref:"OC-2026-097",date:"2026-10-24",status:"sap",created:"11/10 09:12",createdMs:new Date(2026,9,11,9,12).getTime(),approved:"11/10 11:40",approvedMs:new Date(2026,9,11,11,40).getTime(),sapAt:"11/10 11:52",origin:"Portal",
  audit:[{at:"11/10 09:12",who:"Martín (MINOIL S.A.)",what:"Pedido criado no portal com 4 itens e validado automaticamente (carga incompleta, 96%)"},{at:"11/10 11:31",who:"Lucas (Exportação)",kind:"edit",code:"12034103",old:324,nv:405,what:"Alterou 12034103 (Cappuccino Clássico sachê 20 g) de 324 para 405 cx para completar a carreta"},{at:"11/10 11:40",who:"Lucas (Exportação)",what:"Pedido aprovado após 1 ajuste"},{at:"11/10 11:52",who:"Lucas (Exportação)",what:"Arquivo para upload no Sirius/SAP gerado"}]},
  {id:"3CC-2026-0003",client:"rioclaro",veh:"c40",mode:"pal",mixed:false,qty:{"12031291":1176,"12034109":140,"12142501":1400,"12147801":540},ref:"OC-4471",date:"2026-11-03",status:"aprovado",created:"12/10 10:21",createdMs:new Date(2026,9,12,10,21).getTime(),approved:"12/10 14:05",approvedMs:new Date(2026,9,12,14,5).getTime(),origin:"Portal",
  audit:[{at:"12/10 10:21",who:"Sofía (Distribuidora Río Claro S.R.L.)",what:"Pedido criado no portal e validado automaticamente."},{at:"12/10 14:05",who:"Lucas (Exportação)",what:"Pedido aprovado sem alterações."}]}
];

window.PSF_DEMO = { P, CLIENTS, ORDERS };
})();
