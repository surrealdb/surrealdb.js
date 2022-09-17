const nanoid = (chars, length) => {
	let id = [];
	let charlist = chars.split("");

	while (id.length < length) {
		const random = charlist[Math.floor(Math.random() * charlist.length)];

		if (id[id.length - 1] != random) {
			id.push(random);
		}
	}

	return id.join("");
};

export default function () {
	return nanoid("1234567890abcdefghijklmnopqrstuvwxyz", 10);
}
