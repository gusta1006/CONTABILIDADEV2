'use strict';

/* CONTA FÁCIL — versão simplificada
   - Mantém a chave contaFacilTransactions para preservar registros existentes.
   - Permite selecionar qualquer mês/ano dentro do formato de datas do navegador.
   - Calcula o saldo positivo acumulado e mostra a parcela trazida como "Lucro".
   - Os registros continuam salvos localmente neste navegador.
*/

const STORAGE_KEY = 'contaFacilTransactions';
const CATEGORY_KEY = 'contaFacilSimpleCategories';
const RESERVE_BUCKETS = ['IPVA/IPTU','Poupança','Investimento'];
const COLORS = ['#176b4a','#e0a33b','#4f83b8','#bd554d','#8a6bb1','#299b9b','#d17b45','#718b50','#cb6b91','#68747d','#a18b56','#597c9e'];
const defaultCategories = {
  expense: ['Alimentação','Supermercado','Moradia','Água','Energia elétrica','Internet e telefone','Transporte','Combustível','Saúde','Farmácia','Educação','Lazer','Assinaturas','Cartão de crédito','Impostos','IPVA','IPTU','Outras despesas'],
  income: ['Salário','Aposentadoria','Renda extra','Serviços','Vendas','Rendimentos','Outras receitas']
};

const $ = id => document.getElementById(id);
const money = value => Number(value || 0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
// Os cálculos financeiros são acumulados em centavos para reduzir erros de ponto flutuante.
const toCents = value => Math.round(Number(value || 0) * 100);
const todayISO = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0,10);
};
const monthISO = () => todayISO().slice(0,7);

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (error) {
    console.warn(`Não foi possível ler ${key}:`, error);
    return fallback;
  }
}

function safeSave(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (error) {
    console.error(`Não foi possível salvar ${key}:`, error);
    toast('Não foi possível salvar. Verifique o espaço disponível no navegador.');
    return false;
  }
}

let transactions = readJSON(STORAGE_KEY, []);
if (!Array.isArray(transactions)) transactions = [];
// Preserva os quatro tipos encontrados em registros das versões anteriores.
transactions = transactions.filter(t =>
  t && ['income','expense','investment','saving','allocation','withdrawal'].includes(t.type) &&
  typeof t.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(t.date) &&
  Number.isFinite(Number(t.amount)) && Number(t.amount) > 0
).map(t => {
  const item = {...t, amount:Number(t.amount)};
  // Compatibilidade: tipos antigos de poupança/investimento viram destinações.
  if (item.type === 'saving') {
    item.type = 'allocation';
    item.reserveBucket = 'Poupança';
  } else if (item.type === 'investment') {
    item.type = 'allocation';
    item.reserveBucket = 'Investimento';
  }
  if (item.type === 'allocation' && !item.reserveBucket) {
    item.reserveBucket = ['IPVA/IPTU','Poupança','Investimento'].includes(item.category) ? item.category : 'Poupança';
  }
  if (item.type === 'expense' && !item.paidFromReserve) item.paidFromReserve = null;
  return item;
});

let customCategories = readJSON(CATEGORY_KEY, []);
if (!Array.isArray(customCategories)) customCategories = [];
let selectedEntryMonth = monthISO();
let toastTimer;

function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

function saveTransactions() {
  return safeSave(STORAGE_KEY, transactions);
}

function allCategories(type) {
  if (type === 'allocation' || type === 'withdrawal') return RESERVE_BUCKETS;
  return [...defaultCategories[type], ...customCategories.filter(c => c.type === type).map(c => c.name)];
}

function renderCategoryOptions() {
  const type = $('type').value;
  const select = $('category');
  const previous = select.value;
  select.replaceChildren();
  allCategories(type).forEach(name => {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    select.append(option);
  });
  if ([...select.options].some(o => o.value === previous)) select.value = previous;

  const paymentWrap = $('paymentSourceWrap');
  paymentWrap.hidden = type !== 'expense';
  $('categoryForm').hidden = !['income','expense'].includes(type);
  const hint = $('typeHint');
  const hints = {
    expense: 'Despesa: reduz o saldo disponível. Se pagar usando IPVA/IPTU, poupança ou investimento já separado, escolha essa origem para não descontar duas vezes.',
    income: 'Receita: aumenta o dinheiro disponível e pode gerar lucro para o mês seguinte.',
    allocation: 'Separar dinheiro: transfere parte do saldo disponível para IPVA/IPTU, poupança ou investimentos. Não é uma despesa.',
    withdrawal: 'Resgatar valor separado: devolve dinheiro de uma reserva ao saldo disponível. Não é receita.'
  };
  hint.textContent = hints[type] || '';
}

function isValidMonth(value) {
  if (typeof value !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return false;
  const year = Number(value.slice(0,4));
  return year >= 1 && year <= 9999;
}

function monthIndex(value) {
  const [year, month] = value.split('-').map(Number);
  return year * 12 + month - 1;
}

function monthFromIndex(index) {
  const year = Math.floor(index / 12);
  const month = index % 12 + 1;
  return `${String(year).padStart(4,'0')}-${String(month).padStart(2,'0')}`;
}

function daysInMonth(year, month) {
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

// Ao escolher outro mês, mantém o dia selecionado quando ele existir naquele mês.
function dateForMonth(month, preferredDay) {
  const [year, monthNumber] = month.split('-').map(Number);
  const day = Math.min(Math.max(Number(preferredDay) || 1, 1), daysInMonth(year, monthNumber));
  return `${month}-${String(day).padStart(2,'0')}`;
}

function monthLabel(month) {
  const [year, monthNumber] = month.split('-').map(Number);
  const date = new Date(0);
  date.setFullYear(year, monthNumber - 1, 1);
  date.setHours(12,0,0,0);
  return date.toLocaleDateString('pt-BR', {month:'long', year:'numeric'});
}

// Totais do mês: despesas pagas com reserva continuam sendo despesas reais,
// mas não reduzem o saldo disponível pela segunda vez.
function monthlyTotals(month) {
  let incomeCents = 0;
  let expenseCents = 0;
  let cashExpenseCents = 0;
  let allocationCents = { 'IPVA/IPTU':0, 'Poupança':0, 'Investimento':0 };
  let withdrawalCents = 0;
  transactions.forEach(item => {
    if (item.date.slice(0,7) !== month) return;
    if (item.type === 'income') incomeCents += toCents(item.amount);
    if (item.type === 'expense') {
      expenseCents += toCents(item.amount);
      if (!item.paidFromReserve) cashExpenseCents += toCents(item.amount);
    }
    if (item.type === 'allocation') {
      const bucket = item.reserveBucket || item.category;
      if (Object.prototype.hasOwnProperty.call(allocationCents, bucket)) allocationCents[bucket] += toCents(item.amount);
    }
    if (item.type === 'withdrawal') withdrawalCents += toCents(item.amount);
  });
  return {incomeCents, expenseCents, cashExpenseCents, allocationCents, withdrawalCents};
}

/* Saldo positivo transferido de um mês para o seguinte:
   lucro + receitas - despesas pagas do saldo - valores separados + resgates.
   Gastos pagos com reserva não são subtraídos de novo do saldo disponível. */
function calculateCarryIn(targetMonth) {
  const targetIndex = monthIndex(targetMonth);
  const datedMonths = transactions
    .filter(t => t.date.slice(0,7) < targetMonth)
    .map(t => t.date.slice(0,7));
  if (!datedMonths.length) return 0;
  const firstIndex = Math.min(...datedMonths.map(monthIndex));
  if (firstIndex >= targetIndex) return 0;

  const totalsByMonth = new Map();
  transactions.forEach(item => {
    const month = item.date.slice(0,7);
    if (month >= targetMonth) return;
    const key = monthIndex(month);
    if (!totalsByMonth.has(key)) totalsByMonth.set(key, {incomeCents:0, cashExpenseCents:0, allocationCents:0, withdrawalCents:0});
    const totals = totalsByMonth.get(key);
    if (item.type === 'income') totals.incomeCents += toCents(item.amount);
    if (item.type === 'expense' && !item.paidFromReserve) totals.cashExpenseCents += toCents(item.amount);
    if (item.type === 'allocation') totals.allocationCents += toCents(item.amount);
    if (item.type === 'withdrawal') totals.withdrawalCents += toCents(item.amount);
  });

  let carryCents = 0;
  for (let index = firstIndex; index < targetIndex; index += 1) {
    const totals = totalsByMonth.get(index) || {incomeCents:0, cashExpenseCents:0, allocationCents:0, withdrawalCents:0};
    carryCents = Math.max(0, carryCents + totals.incomeCents - totals.cashExpenseCents - totals.allocationCents + totals.withdrawalCents);
  }
  return carryCents / 100;
}

function reserveBalance(bucket, throughDate) {
  let balance = 0;
  transactions.forEach(item => {
    if (item.date > throughDate) return;
    if (item.type === 'allocation' && (item.reserveBucket || item.category) === bucket) balance += toCents(item.amount);
    if (item.type === 'withdrawal' && item.category === bucket) balance -= toCents(item.amount);
    if (item.type === 'expense' && item.paidFromReserve === bucket) balance -= toCents(item.amount);
  });
  return balance / 100;
}

function monthReserveBalance(bucket, month) {
  // O último dia do mês como texto ISO inclui todos os dias válidos do mês.
  return reserveBalance(bucket, `${month}-31`);
}

function availableCashAtDate(targetDate) {
  const month = targetDate.slice(0,7);
  let cents = toCents(calculateCarryIn(month));
  transactions.forEach(item => {
    if (item.date.slice(0,7) !== month || item.date > targetDate) return;
    const amount = toCents(item.amount);
    if (item.type === 'income') cents += amount;
    if (item.type === 'expense' && !item.paidFromReserve) cents -= amount;
    if (item.type === 'allocation') cents -= amount;
    if (item.type === 'withdrawal') cents += amount;
  });
  return cents / 100;
}

function getSelectedMonthBalance() {
  const totals = monthlyTotals(selectedEntryMonth);
  const carry = calculateCarryIn(selectedEntryMonth);
  const balanceCents = toCents(carry) + totals.incomeCents - totals.cashExpenseCents -
    Object.values(totals.allocationCents).reduce((sum,value) => sum + value, 0) + totals.withdrawalCents;
  return {
    income:totals.incomeCents / 100,
    expenses:totals.expenseCents / 100,
    carry,
    balance:balanceCents / 100,
    allocations: Object.fromEntries(Object.entries(totals.allocationCents).map(([k,v]) => [k,v/100]))
  };
}

function updateSummary() {
  const {income, expenses, carry, balance, allocations} = getSelectedMonthBalance();
  $('carryTotal').textContent = money(carry);
  $('incomeTotal').textContent = money(income);
  $('expenseTotal').textContent = money(expenses);
  $('balanceTotal').textContent = money(balance);
  $('ipvaBalance').textContent = money(monthReserveBalance('IPVA/IPTU', selectedEntryMonth));
  $('savingBalance').textContent = money(monthReserveBalance('Poupança', selectedEntryMonth));
  $('investmentBalance').textContent = money(monthReserveBalance('Investimento', selectedEntryMonth));
  $('ipvaMonth').textContent = `Separado neste mês: ${money(allocations['IPVA/IPTU'])}`;
  $('savingMonth').textContent = `Separado neste mês: ${money(allocations['Poupança'])}`;
  $('investmentMonth').textContent = `Destinado neste mês: ${money(allocations['Investimento'])}`;
}

function createTransactionRow(item) {
  const row = document.createElement('div');
  row.className = `transaction-row${item.isCarry ? ' profit-row' : ''}${item.type === 'allocation' ? ' allocation-row' : ''}${item.type === 'withdrawal' ? ' withdrawal-row' : ''}`;

  const main = document.createElement('div');
  main.className = 'transaction-main';
  const title = document.createElement('strong');
  const bucket = item.reserveBucket || item.category;
  title.textContent = item.isCarry ? 'Lucro' : (item.description || item.category || 'Lançamento');
  const detail = document.createElement('small');
  if (item.isCarry) {
    detail.textContent = `Saldo positivo que sobrou de ${monthLabel(monthFromIndex(monthIndex(selectedEntryMonth) - 1))}`;
  } else if (item.type === 'allocation') {
    detail.textContent = `Valor separado para ${bucket} · ${new Date(`${item.date}T12:00:00`).toLocaleDateString('pt-BR')}`;
  } else if (item.type === 'withdrawal') {
    detail.textContent = `Resgate de ${item.category} para o saldo disponível · ${new Date(`${item.date}T12:00:00`).toLocaleDateString('pt-BR')}`;
  } else {
    const origin = item.paidFromReserve ? ` · pago com ${item.paidFromReserve}` : ' · pago com saldo disponível';
    detail.textContent = `${item.category || 'Sem categoria'}${item.type === 'expense' ? origin : ''} · ${new Date(`${item.date}T12:00:00`).toLocaleDateString('pt-BR')}`;
  }
  main.append(title, detail);

  const value = document.createElement('span');
  value.className = `transaction-value ${item.type === 'income' || item.type === 'withdrawal' || item.isCarry ? 'income' : item.type === 'allocation' ? 'allocation' : 'expense'}`;
  const sign = item.type === 'income' || item.type === 'withdrawal' || item.isCarry ? '+' : '−';
  value.textContent = `${sign} ${money(item.amount)}`;

  row.append(main, value);
  if (!item.isCarry) {
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'delete-button';
    del.textContent = '×';
    del.setAttribute('aria-label','Excluir lançamento');
    del.addEventListener('click', () => deleteTransaction(item.id));
    row.append(del);
  } else {
    const mark = document.createElement('span');
    mark.className = 'carry-mark';
    mark.textContent = '↪';
    mark.setAttribute('aria-label','Valor transportado do mês anterior');
    row.append(mark);
  }
  return row;
}

function renderTransactions() {
  const list = $('transactionList');
  list.replaceChildren();
  const monthItems = transactions
    .filter(t => t.date.slice(0,7) === selectedEntryMonth)
    .sort((a,b) => b.date.localeCompare(a.date) || String(b.id).localeCompare(String(a.id)));
  const carry = calculateCarryIn(selectedEntryMonth);

  if (carry > 0) {
    list.append(createTransactionRow({isCarry:true, type:'income', amount:carry}));
  }
  monthItems.forEach(item => list.append(createTransactionRow(item)));

  const count = monthItems.length;
  $('transactionCount').textContent = `${count} ${count === 1 ? 'lançamento' : 'lançamentos'}${carry > 0 ? ' + lucro anterior' : ''}`;
  if (!monthItems.length && carry <= 0) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = `Nenhum lançamento em ${monthLabel(selectedEntryMonth)}.`;
    list.append(p);
  }
}

function reserveWouldBecomeNegativeAfterRemoval(removedId) {
  const events = [];
  transactions.forEach(item => {
    if (String(item.id) === String(removedId)) return;
    if (item.type === 'allocation') events.push({date:item.date, bucket:item.reserveBucket || item.category, delta:toCents(item.amount), priority:0});
    if (item.type === 'withdrawal') events.push({date:item.date, bucket:item.category, delta:-toCents(item.amount), priority:1});
    if (item.type === 'expense' && item.paidFromReserve) events.push({date:item.date, bucket:item.paidFromReserve, delta:-toCents(item.amount), priority:2});
  });
  events.sort((a,b) => a.date.localeCompare(b.date) || a.priority - b.priority);
  const balances = new Map();
  for (const event of events) {
    const next = (balances.get(event.bucket) || 0) + event.delta;
    if (next < 0) return true;
    balances.set(event.bucket,next);
  }
  return false;
}

function deleteTransaction(id) {
  const itemToDelete = transactions.find(t => String(t.id) === String(id));
  if (itemToDelete?.type === 'allocation' && reserveWouldBecomeNegativeAfterRemoval(id)) {
    toast('Não é possível excluir esta reserva: já existem pagamentos ou resgates que dependem dela. Exclua ou ajuste esses registros primeiro.');
    return;
  }
  if (!confirm('Deseja excluir este lançamento?')) return;
  const previous = transactions;
  transactions = transactions.filter(t => String(t.id) !== String(id));
  if (saveTransactions()) {
    renderAll();
    toast('Lançamento excluído.');
  } else {
    transactions = previous;
  }
}

function renderCategoryChips() {
  const wrap = $('categoryChips');
  wrap.replaceChildren();
  customCategories.forEach(category => {
    const chip = document.createElement('span');
    chip.className = 'category-chip custom';
    chip.textContent = `${category.name} · ${category.type === 'expense' ? 'Despesa' : 'Receita'}`;
    wrap.append(chip);
  });
  if (!customCategories.length) {
    const note = document.createElement('span');
    note.className = 'muted';
    note.textContent = 'Nenhuma categoria personalizada adicionada.';
    wrap.append(note);
  }
}

function renderMonthlyChart() {
  const selected = $('monthPicker').value || monthISO();
  const totals = monthlyTotals(selected);
  $('reportIpva').textContent = money(totals.allocationCents['IPVA/IPTU'] / 100);
  $('reportSaving').textContent = money(totals.allocationCents['Poupança'] / 100);
  $('reportInvestment').textContent = money(totals.allocationCents['Investimento'] / 100);
  const sums = new Map();
  transactions.filter(t => t.date.startsWith(selected) && t.type === 'expense').forEach(item => {
    const name = item.category || 'Outros';
    sums.set(name, (sums.get(name) || 0) + toCents(item.amount));
  });
  const entries = [...sums.entries()].sort((a,b) => b[1] - a[1]);
  const totalCents = entries.reduce((sum, entry) => sum + entry[1], 0);
  $('pieTotal').textContent = money(totalCents / 100);
  const pie = $('monthlyPie');
  pie.replaceChildren();
  const legend = $('pieLegend');
  legend.replaceChildren();

  if (!entries.length) {
    pie.style.background = 'conic-gradient(#edf2ee 0deg 360deg)';
    const label = document.createElement('span');
    label.textContent = 'Sem dados';
    pie.append(label);
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = 'Cadastre despesas para visualizar o gráfico.';
    legend.append(p);
    return;
  }

  let angle = 0;
  const slices = [];
  entries.forEach(([name,value], index) => {
    const next = angle + (value / totalCents * 360);
    slices.push(`${COLORS[index % COLORS.length]} ${angle}deg ${next}deg`);
    angle = next;
    const item = document.createElement('div');
    item.className = 'legend-item';
    const swatch = document.createElement('i');
    swatch.className = 'legend-swatch';
    swatch.style.backgroundColor = COLORS[index % COLORS.length];
    const label = document.createElement('span');
    label.textContent = name;
    const amount = document.createElement('strong');
    amount.textContent = money(value / 100);
    item.append(swatch,label,amount);
    legend.append(item);
  });
  pie.style.background = `conic-gradient(${slices.join(',')})`;
  const center = document.createElement('span');
  center.textContent = money(totalCents / 100);
  pie.append(center);
}

function renderAnnualChart() {
  const rawYear = $('yearPicker').value;
  const year = Number(rawYear);
  const validYear = Number.isInteger(year) && year >= 1 && year <= 9999;
  const totals = Array(12).fill(0);
  if (validYear) {
    transactions.filter(t => t.date.slice(0,4) === String(year).padStart(4,'0') && t.type === 'expense').forEach(item => {
      const month = Number(item.date.slice(5,7)) - 1;
      if (month >= 0 && month < 12) totals[month] += toCents(item.amount);
    });
  }
  const totalCents = totals.reduce((sum,value) => sum + value, 0);
  $('annualTotal').textContent = money(totalCents / 100);
  const chart = $('annualBars');
  chart.replaceChildren();
  const max = Math.max(...totals, 1);
  const names = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  totals.forEach((value,index) => {
    const col = document.createElement('div');
    col.className = 'bar-column';
    const labelValue = document.createElement('span');
    labelValue.className = 'bar-value';
    labelValue.textContent = value ? money(value / 100).replace(',00','') : ' ';
    const track = document.createElement('div');
    track.className = 'bar-track';
    const fill = document.createElement('div');
    fill.className = 'bar-fill';
    fill.style.height = `${value ? Math.max(3,value / max * 100) : 0}%`;
    fill.title = `${names[index]}: ${money(value / 100)}`;
    track.append(fill);
    const label = document.createElement('span');
    label.className = 'bar-label';
    label.textContent = names[index];
    col.append(labelValue,track,label);
    chart.append(col);
  });
}

function renderAll() {
  updateSummary();
  renderTransactions();
  renderCategoryChips();
  renderMonthlyChart();
  renderAnnualChart();
}

// Muda o período de trabalho e mantém a data dentro do mês escolhido.
$('entryMonthPicker').addEventListener('change', () => {
  const month = $('entryMonthPicker').value;
  if (!isValidMonth(month)) {
    toast('Escolha um mês e ano válidos.');
    $('entryMonthPicker').value = selectedEntryMonth;
    return;
  }
  selectedEntryMonth = month;
  $('date').value = dateForMonth(month, $('date').value.slice(8,10));
  $('monthPicker').value = month;
  renderAll();
});

// Se a pessoa alterar a data diretamente, atualiza o mês de trabalho também.
$('date').addEventListener('change', () => {
  const date = $('date').value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
  selectedEntryMonth = date.slice(0,7);
  $('entryMonthPicker').value = selectedEntryMonth;
  $('monthPicker').value = selectedEntryMonth;
  renderAll();
});

$('transactionForm').addEventListener('submit', event => {
  event.preventDefault();
  const amount = Number($('amount').value);
  const date = $('date').value;
  const category = $('category').value;
  const type = $('type').value;
  const paymentSource = $('paymentSource').value;
  const amountCents = toCents(amount);
  if (!Number.isFinite(amount) || amountCents < 1 || amount > 1000000000) {
    toast('Informe um valor válido de pelo menos R$ 0,01.');
    return;
  }
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date.slice(0,7) !== selectedEntryMonth) {
    toast('Confira a data e o mês selecionado.');
    return;
  }
  if (!category) {
    toast('Escolha uma categoria ou finalidade.');
    return;
  }

  if (type === 'allocation') {
    const available = availableCashAtDate(date);
    if (amountCents > toCents(available)) {
      toast(`O saldo disponível nesta data é ${money(Math.max(0,available))}. Não é possível separar um valor maior que esse saldo.`);
      return;
    }
  }

  let paidFromReserve = null;
  if (type === 'expense' && paymentSource !== 'cash') {
    const available = reserveBalance(paymentSource, date);
    if (amountCents > toCents(available)) {
      toast(`A reserva ${paymentSource} tem ${money(Math.max(0,available))} disponível nesta data. Escolha outra origem ou ajuste o valor.`);
      return;
    }
    paidFromReserve = paymentSource;
  }
  if (type === 'withdrawal') {
    const available = reserveBalance(category, date);
    if (amountCents > toCents(available)) {
      toast(`A reserva ${category} tem ${money(Math.max(0,available))} disponível nesta data.`);
      return;
    }
  }

  const item = {
    id:`${Date.now()}-${Math.random().toString(16).slice(2)}`,
    mode:'pf',
    description:$('description').value.trim().slice(0,70) || (type === 'allocation' ? `Separado para ${category}` : type === 'withdrawal' ? `Resgate de ${category}` : category),
    amount:amountCents / 100,
    type,
    category,
    date,
    ...(type === 'allocation' ? {reserveBucket:category} : {}),
    ...(type === 'expense' ? {paidFromReserve} : {})
  };
  transactions.push(item);
  if (saveTransactions()) {
    $('amount').value = '';
    $('description').value = '';
    renderAll();
    $('amount').focus();
    const messages = {
      allocation:'Valor separado. Ele não foi contado como despesa.',
      withdrawal:'Resgate registrado e somado ao saldo disponível.',
      expense:paidFromReserve ? `Despesa registrada usando a reserva ${paidFromReserve}.` : 'Despesa salva com sucesso.',
      income:'Receita salva com sucesso.'
    };
    toast(messages[type]);
  } else {
    transactions.pop();
  }
});

$('type').addEventListener('change',() => {
  // Evita que uma escolha anterior de reserva seja aplicada sem querer à próxima despesa.
  if ($('type').value === 'expense') $('paymentSource').value = 'cash';
  renderCategoryOptions();
});

$('categoryForm').addEventListener('submit',event => {
  event.preventDefault();
  const name = $('newCategory').value.trim().replace(/\s+/g,' ');
  if (name.length < 2) {
    toast('Digite um nome de categoria válido.');
    return;
  }
  const allNames = [...defaultCategories.expense,...defaultCategories.income,...customCategories.map(c => c.name)];
  if (allNames.some(category => category.toLocaleLowerCase('pt-BR') === name.toLocaleLowerCase('pt-BR'))) {
    toast('Essa categoria já existe.');
    return;
  }
  const type = $('type').value;
  if (!['income','expense'].includes(type)) { toast('Categorias personalizadas são para receitas e despesas.'); return; }
  customCategories.push({name,type});
  if (safeSave(CATEGORY_KEY,customCategories)) {
    $('newCategory').value = '';
    renderCategoryOptions();
    $('category').value = name;
    renderCategoryChips();
    toast('Nova categoria adicionada.');
  } else {
    customCategories.pop();
  }
});

$('monthPicker').addEventListener('change',renderMonthlyChart);
$('yearPicker').addEventListener('change',renderAnnualChart);

$('yearPicker').addEventListener('input', () => {
  // Permite digitar livremente o ano sem depender de uma lista pré-montada.
  const year = Number($('yearPicker').value);
  if ($('yearPicker').value === '' || (Number.isInteger(year) && year >= 1 && year <= 9999)) renderAnnualChart();
});

document.querySelectorAll('.tab').forEach(button => button.addEventListener('click',() => {
  const target = button.dataset.tab;
  document.querySelectorAll('.tab').forEach(tab => tab.classList.toggle('active',tab === button));
  document.querySelectorAll('.tab-panel').forEach(panel => {
    const active = panel.dataset.panel === target;
    panel.classList.toggle('active',active);
    panel.hidden = !active;
  });
  if (target === 'relatorios') {
    renderMonthlyChart();
    renderAnnualChart();
  }
}));

$('backupButton').addEventListener('click',() => {
  const backup = {
    application:'CONTA FACIL',
    schemaVersion:4,
    exportedAt:new Date().toISOString(),
    transactions,
    customCategories
  };
  const blob = new Blob([JSON.stringify(backup,null,2)],{type:'application/json'});
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `conta-facil-backup-${todayISO()}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url),1000);
  toast('Backup criado. Guarde em local seguro.');
});

// Inicialização. O seletor numérico de ano não possui uma lista fechada de opções.
$('todayLabel').textContent = new Date().toLocaleDateString('pt-BR',{weekday:'long',day:'2-digit',month:'long'});
$('yearNow').textContent = new Date().getFullYear();
$('entryMonthPicker').value = selectedEntryMonth;
$('monthPicker').value = selectedEntryMonth;
$('date').value = todayISO();
$('yearPicker').value = String(new Date().getFullYear());
renderCategoryOptions();
renderAll();
