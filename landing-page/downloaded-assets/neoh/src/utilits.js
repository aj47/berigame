export const animationText = () => {
  const fn_animated_text = document.querySelectorAll(".fn_animated_text");
  fn_animated_text.forEach((text) => {
    let letters = text.innerHTML.split(""),
      time = text.getAttribute("wait"),
      speed = text.getAttribute("speed");
    if (!time) {
      time = 0;
    }
    if (!speed) {
      speed = 4;
    }
    speed = speed / 100;
    text.innerHTML = "<em>321...</em>";
    text.classList.add("ready");
    if (typeof window !== "undefined") {
      require("waypoints/lib/noframework.waypoints.min.js");
      var waypoint = new Waypoint({
        element: text,
        handler: function () {
          if (!text.classList.contains("stop")) {
            text.classList.add("stop");
            setTimeout(() => {
              text.innerHTML = "";
              letters.forEach((i, e) => {
                var span = document.createElement("span");
                span.textContent = i;
                span.style.animationDelay = e * speed + "s";
                text.append(span);
              });
            }, time);
          }
        },

        offset: "90%",
      });
    }
  });
};

export const neoh_fn_moving_blog = () => {
  const blog = document.querySelector(".neoh_fn_moving_blog");
  if (blog) {
    const neoh_fn_moving_box = document.querySelector(".neoh_fn_moving_box");
    if (!neoh_fn_moving_box) {
      let body = document.querySelector("body");
      let div = document.createElement("div");
      div.classList.add("neoh_fn_moving_box");
      body.appendChild(div);
    }
    let movingBox = document.querySelector(".neoh_fn_moving_box");
    let blogItems = document.querySelectorAll(".neoh_fn_moving_blog .item");
    blogItems.forEach((list) => {
      list.addEventListener("mouseenter", (event) => {
        if (!list.classList.contains("active")) {
          list.classList.remove("active");
          list.classList.add("active");
          movingBox.classList.add("active");
          var imgURL = list.querySelector(".moving_img").getAttribute("src");
          movingBox.style.backgroundImage = `url(${imgURL})`;
          movingBox.style.left = event.clientX + 15 + "px";
          movingBox.style.top = event.clientY + 15 + "px";
        }
      });
      list.addEventListener("mouseleave", () => {
        list.classList.remove("active");
        movingBox.classList.remove("active");
      });
      list.addEventListener("mousemove", (event) => {
        movingBox.style.left = event.clientX + 15 + "px";
        movingBox.style.top = event.clientY + 15 + "px";
      });
    });
  }
};

export const stickyNav = () => {
  let offset = window.scrollY;
  const stickys = document.querySelectorAll(".neoh_fn_header");
  for (let i = 0; i < stickys.length; i++) {
    const sticky = stickys[i];
    if (sticky) {
      if (offset > 10) {
        sticky.classList.add("fixer");
      } else {
        sticky.classList.remove("fixer");
      }
    }
  }
};

// Data image
export const dataBgImg = () => {
  let d = document.querySelectorAll("[data-bg-img]");
  for (let i = 0; i < d.length; i++) {
    const element = d[i];
    element.style.backgroundImage = `url(${element.getAttribute(
      "data-bg-img"
    )})`;
  }
};

export const imgToSVG = () => {
  document.querySelectorAll("img.fn__svg").forEach((el) => {
    const imgID = el.getAttribute("id");
    const imgClass = el.getAttribute("class");
    const imgURL = el.getAttribute("src");

    fetch(imgURL)
      .then((data) => data.text())
      .then((response) => {
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(response, "text/html");
        let svg = xmlDoc.querySelector("svg");

        if (typeof imgID !== "undefined") {
          svg.setAttribute("id", imgID);
        }

        if (typeof imgClass !== "undefined") {
          svg.setAttribute("class", imgClass + " replaced-svg");
        }

        svg.removeAttribute("xmlns:a");

        el.parentNode && el.parentNode.replaceChild(svg, el);
      });
  });
};

export const progressTotop = () => {
  var winScroll = window.pageYOffset;
  var height = document.body.clientHeight;
  var scrolled = parseInt((winScroll / (height - window.innerHeight)) * 300);
  var totop = document.querySelector(".neoh_fn_totop");
  if (winScroll > 0) {
    totop.classList.add("active");
  } else {
    totop.classList.remove("active");
  }
  let strockSolid = totop.querySelector(".stroke-solid");
  if (strockSolid) {
    strockSolid.style.strokeDashoffset = 300 - scrolled;
  }
  // totop.querySelector(".stroke-solid").css("stroke-dashoffset", 300 - scrolled);
};

// paggination
export const pagination = (listClass, sort, active) => {
  let list = document.querySelectorAll(listClass);
  for (let i = 0; i < list.length; i++) {
    const element = list[i];
    if (active === 1) {
      if (i < sort) {
        element.classList.remove("d-none");
      } else {
        element.classList.add("d-none");
      }
    } else {
      if (i >= (active - 1) * sort && i < active * sort) {
        element.classList.remove("d-none");
      } else {
        element.classList.add("d-none");
      }
    }
  }
};

export const getPagination = (totalNumber, sort) => {
  let arr = new Array(Math.ceil(totalNumber / sort))
    .fill()
    .map((_, idx) => idx + 1);
  return arr;
};
