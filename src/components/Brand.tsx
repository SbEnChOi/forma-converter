export function FormaMark({ small = false }: { small?: boolean }) {
  return <svg className={small ? 'forma-mark small' : 'forma-mark'} viewBox="0 0 44 44" fill="none" aria-hidden="true">
    <defs>
      <linearGradient id="forma-blue" x1="6" y1="3" x2="38" y2="44" gradientUnits="userSpaceOnUse">
        <stop stopColor="#65A0FF" /><stop offset="1" stopColor="#2469E8" />
      </linearGradient>
      <linearGradient id="forma-paper" x1="15" y1="9" x2="32" y2="36" gradientUnits="userSpaceOnUse">
        <stop stopColor="white" /><stop offset="1" stopColor="#DEEAFF" />
      </linearGradient>
    </defs>
    <rect x="1" y="1" width="42" height="42" rx="12" fill="url(#forma-blue)" />
    <rect x="1.5" y="1.5" width="41" height="41" rx="11.5" stroke="white" strokeOpacity=".22" />
    <path d="M14 13a3 3 0 0 1 3-3h10l6 6v14a3 3 0 0 1-3 3H17a3 3 0 0 1-3-3V13Z" fill="white" fillOpacity=".24" transform="rotate(-12 23 22)" />
    <path d="M13 12a3 3 0 0 1 3-3h11l6 6v16a3 3 0 0 1-3 3H16a3 3 0 0 1-3-3V12Z" fill="url(#forma-paper)" />
    <path d="M27 9v4a2 2 0 0 0 2 2h4" fill="#BFD6FF" />
    <path d="M18.5 21h10m-10 5h7" stroke="#4D83DE" strokeWidth="2" strokeLinecap="round" />
  </svg>;
}

export function FileIllustration() {
  return <div className="file-illustration" aria-hidden="true">
    <div className="illustration-glow" />
    <svg viewBox="0 0 160 124" fill="none">
      <defs>
        <linearGradient id="paper-front" x1="66" y1="24" x2="110" y2="116" gradientUnits="userSpaceOnUse"><stop stopColor="#fff" /><stop offset="1" stopColor="#F2F5FA" /></linearGradient>
        <linearGradient id="photo-back" x1="31" y1="24" x2="88" y2="86" gradientUnits="userSpaceOnUse"><stop stopColor="#F7FAFF" /><stop offset="1" stopColor="#E9F0FB" /></linearGradient>
        <filter id="paper-shadow" x="0" y="0" width="160" height="150" filterUnits="userSpaceOnUse"><feDropShadow dx="0" dy="4" stdDeviation="5" floodColor="#16356F" floodOpacity=".1" /></filter>
      </defs>
      <g filter="url(#paper-shadow)">
        <g transform="rotate(-13 61 63)"><rect x="27" y="24" width="65" height="78" rx="8" fill="url(#photo-back)" stroke="#DDE5F1" /><rect x="35" y="34" width="49" height="44" rx="4" fill="#E0EBFC" /><circle cx="70" cy="45" r="5" fill="#B9D0F7" /><path d="m35 70 15-17 13 13 8-8 13 14v6H35v-8Z" fill="#AAC5EF" /><path d="M37 88h24" stroke="#CFD9E8" strokeWidth="3" strokeLinecap="round" /></g>
        <g transform="rotate(10 103 66)"><path d="M76 17h33l20 20v65a8 8 0 0 1-8 8H76a8 8 0 0 1-8-8V25a8 8 0 0 1 8-8Z" fill="url(#paper-front)" stroke="#D8E1EF" /><path d="M109 17v13a7 7 0 0 0 7 7h13" fill="#E6EDF8" /><rect x="81" y="49" width="34" height="5" rx="2.5" fill="#9FBCEC" /><path d="M82 64h31M82 73h25M82 82h31" stroke="#D6E1F1" strokeWidth="3" strokeLinecap="round" /></g>
      </g>
      <circle cx="43" cy="93" r="17" fill="#387CEA" /><path d="M35 93h15m-5-5 5 5-5 5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  </div>;
}
