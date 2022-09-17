function rand(min, max) {
	return (
		(Math.floor(Math.pow(10, 14) * Math.random() * Math.random()) %
			(max - min + 1)) +
		min
	);
}

const nanoid = (chars, length) => {
	let id = [];
	let charlist = chars.split("");

	while (id.length < length) {
		const random = charlist[rand(0, charlist.length)];

		if (id[id.length - 1] != random) {
			id.push(random);
		}
	}

	return id.join("");
};

export default function () {
	return nanoid("1234567890abcdefghijklmnopqrstuvwxyz", 10);
}
